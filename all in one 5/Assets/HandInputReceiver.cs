using System.Net;
using System.Net.Sockets;
using System.Text;
using UnityEngine;

public class HandInputReceiver : MonoBehaviour
{
    [System.Serializable]
    public class HandData
    {
        public float x;
        public float y;

        public float index_x;
        public float index_y;

        public float thumb_x;
        public float thumb_y;

        public float pinch_distance;
        public float openness;

        public float qx;
        public float qy;
        public float qz;
        public float qw;

        public string gesture;
        public bool pinch;
    }

    public Transform targetObject;

    [Header("MOVE")]
    public float moveWidth = 6f;
    public float moveHeight = 4f;
    public float moveHeightOffset = 1f;
    public float moveSmoothing = 0.25f;

    [Header("SCALE")]
    public float minScale = 0.25f;
    public float maxScale = 4f;
    public float scaleSmoothing = 0.15f;

    [Header("ROTATION")]
    public float rotationSmoothing = 0.18f;
    public float rotationMultiplier = 1.0f;

    private UdpClient udpClient;
    private IPEndPoint endPoint;

    private HandData latestData;
    private readonly object dataLock = new object();

    private string previousGesture = "NONE";

    private float scaleStartOpenness;
    private float scaleStartValue;

    private Quaternion startHandRotation;
    private Quaternion startCubeRotation;

    void Start()
    {
        if (targetObject == null)
        {
            Debug.LogError(
                "KINESIS: Assign Target Object."
            );
            return;
        }

        udpClient = new UdpClient(5051);

        endPoint = new IPEndPoint(
            IPAddress.Any,
            5051
        );

        udpClient.BeginReceive(
            ReceiveData,
            null
        );

        Debug.Log(
            "KINESIS: UDP READY"
        );
    }

    void ReceiveData(System.IAsyncResult result)
    {
        try
        {
            byte[] bytes =
                udpClient.EndReceive(
                    result,
                    ref endPoint
                );

            string json =
                Encoding.UTF8.GetString(bytes);

            HandData data =
                JsonUtility.FromJson<HandData>(
                    json
                );

            lock (dataLock)
            {
                latestData = data;
            }

            udpClient.BeginReceive(
                ReceiveData,
                null
            );
        }
        catch
        {
        }
    }

    void Update()
    {
        if (targetObject == null)
            return;

        HandData data;

        lock (dataLock)
        {
            data = latestData;
        }

        if (data == null)
            return;

        string gesture = data.gesture;

        if (gesture != previousGesture)
        {
            StartGesture(
                gesture,
                data
            );

            previousGesture = gesture;
        }

        if (gesture == "MOVE")
        {
            HandleMove(data);
        }
        else if (gesture == "SCALE")
        {
            HandleScale(data);
        }
        else if (gesture == "ROTATE")
        {
            HandleRotation(data);
        }
    }

    void StartGesture(
        string gesture,
        HandData data
    )
    {
        if (gesture == "SCALE")
        {
            scaleStartOpenness =
                data.openness;

            scaleStartValue =
                targetObject.localScale.x;
        }

        if (gesture == "ROTATE")
        {
            startHandRotation =
                new Quaternion(
                    data.qx,
                    data.qy,
                    data.qz,
                    data.qw
                );

            startCubeRotation =
                targetObject.rotation;
        }
    }

    // ========================================================
    // MOVE
    // ========================================================

    void HandleMove(HandData data)
    {
        float x =
            (data.x - 0.5f)
            * moveWidth;

        float y =
            (0.5f - data.y)
            * moveHeight;

        Vector3 target =
            new Vector3(
                x,
                y + moveHeightOffset,
                targetObject.position.z
            );

        targetObject.position =
            Vector3.Lerp(
                targetObject.position,
                target,
                moveSmoothing
            );
    }

    // ========================================================
    // SCALE
    // ========================================================

    void HandleScale(HandData data)
    {
        if (scaleStartOpenness <= 0.001f)
            return;

        float ratio =
            data.openness /
            scaleStartOpenness;

        float desiredScale =
            scaleStartValue * ratio;

        desiredScale =
            Mathf.Clamp(
                desiredScale,
                minScale,
                maxScale
            );

        float current =
            targetObject.localScale.x;

        float smooth =
            Mathf.Lerp(
                current,
                desiredScale,
                scaleSmoothing
            );

        targetObject.localScale =
            Vector3.one * smooth;
    }

    // ========================================================
    // ROTATION
    // ========================================================

    void HandleRotation(HandData data)
    {
        Quaternion currentHandRotation =
            new Quaternion(
                data.qx,
                data.qy,
                data.qz,
                data.qw
            );

        Quaternion delta =
            currentHandRotation
            * Quaternion.Inverse(
                startHandRotation
            );

        Quaternion desiredRotation =
            startCubeRotation
            * Quaternion.Slerp(
                Quaternion.identity,
                delta,
                rotationMultiplier
            );

        targetObject.rotation =
            Quaternion.Slerp(
                targetObject.rotation,
                desiredRotation,
                rotationSmoothing
            );
    }

    void OnApplicationQuit()
    {
        if (udpClient != null)
        {
            udpClient.Close();
        }
    }
}