import cv2
import mediapipe as mp
import socket
import json
import math
import time
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "models", "hand_landmarker.task")

UNITY_IP = "127.0.0.1"
UNITY_PORT = 5051

# Phase 2 addition: same packets, also sent to the React app's gesture
# bridge relay (see /bridge). Unity keeps receiving on UNITY_PORT exactly
# as before — this is a second, independent destination, not a replacement.
BRIDGE_PORT = 5052

PINCH_THRESHOLD = 0.055

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

BaseOptions = mp.tasks.BaseOptions
HandLandmarker = mp.tasks.vision.HandLandmarker
HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
RunningMode = mp.tasks.vision.RunningMode

options = HandLandmarkerOptions(
    base_options=BaseOptions(
        model_asset_path=MODEL_PATH
    ),
    running_mode=RunningMode.VIDEO,
    num_hands=1,
    min_hand_detection_confidence=0.75,
    min_hand_presence_confidence=0.75,
    min_tracking_confidence=0.75
)


def distance(a, b):
    return math.sqrt(
        (a.x - b.x) ** 2 +
        (a.y - b.y) ** 2 +
        (a.z - b.z) ** 2
    )


def angle(a, b, c):
    ba = (
        a.x - b.x,
        a.y - b.y,
        a.z - b.z
    )

    bc = (
        c.x - b.x,
        c.y - b.y,
        c.z - b.z
    )

    dot = (
        ba[0] * bc[0] +
        ba[1] * bc[1] +
        ba[2] * bc[2]
    )

    m1 = math.sqrt(
        ba[0] ** 2 +
        ba[1] ** 2 +
        ba[2] ** 2
    )

    m2 = math.sqrt(
        bc[0] ** 2 +
        bc[1] ** 2 +
        bc[2] ** 2
    )

    if m1 == 0 or m2 == 0:
        return 0

    value = dot / (m1 * m2)
    value = max(-1, min(1, value))

    return math.degrees(math.acos(value))


def finger_extended(hand, mcp, pip, tip):
    return angle(
        hand[mcp],
        hand[pip],
        hand[tip]
    ) > 150


def thumb_extended(hand):
    return angle(
        hand[2],
        hand[3],
        hand[4]
    ) > 140


def hand_openness(hand):

    palm = hand[9]

    palm_size = distance(
        hand[0],
        hand[9]
    )

    if palm_size < 0.001:
        return 0

    values = [
        distance(palm, hand[8]),
        distance(palm, hand[12]),
        distance(palm, hand[16]),
        distance(palm, hand[20])
    ]

    return (sum(values) / 4) / palm_size


def classify(hand):

    thumb = hand[4]
    index = hand[8]

    pinch_distance = distance(
        thumb,
        index
    )

    index_up = finger_extended(
        hand, 5, 6, 8
    )

    middle_up = finger_extended(
        hand, 9, 10, 12
    )

    ring_up = finger_extended(
        hand, 13, 14, 16
    )

    pinky_up = finger_extended(
        hand, 17, 18, 20
    )

    thumb_up = thumb_extended(hand)

    # --------------------------------------------------------
    # ROTATE
    # Keep the existing rotate pose because it is reliable:
    # thumb + index extended, remaining fingers folded.
    # --------------------------------------------------------
    rotate_pose = (
        thumb_up
        and index_up
        and not middle_up
        and not ring_up
        and not pinky_up
        and pinch_distance > PINCH_THRESHOLD
    )

    if rotate_pose:
        return "ROTATE", pinch_distance

    # --------------------------------------------------------
    # MOVE
    # A pinch is enough to enter MOVE. The old classifier also
    # required two other fingers to be extended, which made the
    # gesture unnecessarily hard to trigger.
    # --------------------------------------------------------
    move_pose = pinch_distance < PINCH_THRESHOLD

    if move_pose:
        return "MOVE", pinch_distance

    # --------------------------------------------------------
    # SCALE
    # Use an open/relaxed hand for SCALE, but do NOT require all
    # four fingers to remain fully extended. That is important:
    # the user must be able to close the hand gradually to make
    # the object smaller while staying in SCALE mode.
    # At least index + middle extended is enough to enter/keep
    # SCALE, provided this is not the rotate pose.
    # --------------------------------------------------------
    scale_pose = (
        not move_pose
        and (
            (index_up and middle_up)
            or (index_up and ring_up)
            or (middle_up and ring_up)
            or (index_up and middle_up and ring_up and pinky_up)
        )
    )

    if scale_pose:
        return "SCALE", pinch_distance

    return "NONE", pinch_distance


# ============================================================
# VECTOR HELPERS
# ============================================================

def normalize(v):

    length = math.sqrt(
        v[0] ** 2 +
        v[1] ** 2 +
        v[2] ** 2
    )

    if length < 0.00001:
        return (0, 0, 0)

    return (
        v[0] / length,
        v[1] / length,
        v[2] / length
    )


def subtract(a, b):
    return (
        a.x - b.x,
        a.y - b.y,
        a.z - b.z
    )


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    )


def dot(a, b):
    return (
        a[0] * b[0] +
        a[1] * b[1] +
        a[2] * b[2]
    )


# ============================================================
# PALM → QUATERNION
# ============================================================

def hand_quaternion(hand):

    wrist = hand[0]
    index_mcp = hand[5]
    middle_mcp = hand[9]
    pinky_mcp = hand[17]

    # X axis = across palm
    x_axis = normalize(
        subtract(index_mcp, pinky_mcp)
    )

    # Temporary Y direction
    y_temp = normalize(
        subtract(middle_mcp, wrist)
    )

    # Z axis = palm normal
    z_axis = normalize(
        cross(x_axis, y_temp)
    )

    # Recalculate Y so all three axes are orthogonal
    y_axis = normalize(
        cross(z_axis, x_axis)
    )

    # Rotation matrix
    m00 = x_axis[0]
    m01 = y_axis[0]
    m02 = z_axis[0]

    m10 = x_axis[1]
    m11 = y_axis[1]
    m12 = z_axis[1]

    m20 = x_axis[2]
    m21 = y_axis[2]
    m22 = z_axis[2]

    trace = m00 + m11 + m22

    if trace > 0:

        s = math.sqrt(trace + 1.0) * 2

        qw = 0.25 * s
        qx = (m21 - m12) / s
        qy = (m02 - m20) / s
        qz = (m10 - m01) / s

    elif m00 > m11 and m00 > m22:

        s = math.sqrt(
            1.0 + m00 - m11 - m22
        ) * 2

        qw = (m21 - m12) / s
        qx = 0.25 * s
        qy = (m01 + m10) / s
        qz = (m02 + m20) / s

    elif m11 > m22:

        s = math.sqrt(
            1.0 + m11 - m00 - m22
        ) * 2

        qw = (m02 - m20) / s
        qx = (m01 + m10) / s
        qy = 0.25 * s
        qz = (m12 + m21) / s

    else:

        s = math.sqrt(
            1.0 + m22 - m00 - m11
        ) * 2

        qw = (m10 - m01) / s
        qx = (m02 + m20) / s
        qy = (m12 + m21) / s
        qz = 0.25 * s

    return qx, qy, qz, qw


# ============================================================
# CAMERA
# ============================================================

cap = cv2.VideoCapture(0)

if not cap.isOpened():
    raise RuntimeError("Could not open webcam.")

cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)


# ============================================================
# MAIN
# ============================================================

with HandLandmarker.create_from_options(options) as landmarker:

    last_timestamp = 0

    while True:

        success, frame = cap.read()

        if not success:
            break

        frame = cv2.flip(frame, 1)

        rgb = cv2.cvtColor(
            frame,
            cv2.COLOR_BGR2RGB
        )

        timestamp = int(
            time.monotonic() * 1000
        )

        if timestamp <= last_timestamp:
            timestamp = last_timestamp + 1

        last_timestamp = timestamp

        image = mp.Image(
            image_format=mp.ImageFormat.SRGB,
            data=rgb
        )

        result = landmarker.detect_for_video(
            image,
            timestamp
        )

        gesture = "NONE"

        if result.hand_landmarks:

            hand = result.hand_landmarks[0]

            palm = hand[9]
            index = hand[8]
            thumb = hand[4]

            gesture, pinch_distance = classify(hand)

            openness = hand_openness(hand)

            # 3D hand orientation
            qx, qy, qz, qw = hand_quaternion(hand)

            data = {
                "x": palm.x,
                "y": palm.y,

                "index_x": index.x,
                "index_y": index.y,

                "thumb_x": thumb.x,
                "thumb_y": thumb.y,

                "pinch_distance": pinch_distance,

                "openness": openness,

                "qx": qx,
                "qy": qy,
                "qz": qz,
                "qw": qw,

                "gesture": gesture,

                "pinch": gesture == "MOVE"
            }

            sock.sendto(
                json.dumps(data).encode(),
                (UNITY_IP, UNITY_PORT)
            )

            # Phase 2 addition: fan the same packet out to the React app's
            # gesture bridge relay. Fire-and-forget, same as the Unity send
            # above — if the bridge isn't running, this is a no-op UDP send
            # to a closed port and doesn't affect Unity in any way.
            sock.sendto(
                json.dumps(data).encode(),
                (UNITY_IP, BRIDGE_PORT)
            )

            cv2.putText(
                frame,
                gesture,
                (30, 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                1,
                (0, 255, 0),
                2
            )

            cv2.putText(
                frame,
                f"Open: {openness:.2f}",
                (30, 85),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (255, 255, 255),
                2
            )

            for point in hand:

                px = int(
                    point.x * frame.shape[1]
                )

                py = int(
                    point.y * frame.shape[0]
                )

                cv2.circle(
                    frame,
                    (px, py),
                    4,
                    (0, 255, 0),
                    -1
                )

        cv2.imshow(
            "Kinesis - Hand Tracking",
            frame
        )

        if cv2.waitKey(1) & 0xFF == 27:
            break


cap.release()
cv2.destroyAllWindows()
sock.close()