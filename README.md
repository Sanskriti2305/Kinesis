# Meta Quest 3S Testing

### 1. Connect Meta Quest 3S to the laptop

* Turn on the **Meta Quest 3S**.
* Connect it to the laptop using **Quest Link / Air Link**.
* Make sure the headset is connected successfully.

### 2. Open the Kinesis project

Open PowerShell and run:

```powershell
cd "C:\Users\Palak Upadhyay\Downloads\Kinesis-Push\Phase4"
```

> If the project is cloned somewhere else, use that `Phase4` folder path instead.

### 3. Install dependencies

Run:

```powershell
npm install
```

Wait until it finishes.

### 4. Start Kinesis

Run:

```powershell
npm run dev
```

You should see something like:

```text
Local: http://localhost:5173/
```

### 5. Open Kinesis

Open the shown **localhost URL** in **Google Chrome** on the laptop.

Example:

```text
http://localhost:5173/
```

### 6. Start the VR session

* In Kinesis, look at the top toolbar.
* Click **🥽 Quest 3S**.
* Put on the headset.
* Accept the **Enter VR / Quest Link** prompt if it appears.

### 7. Check whether VR is working

Inside the headset, verify that:

* The Kinesis 3D workspace is visible.
* The scene is rendered correctly.
* Head movement changes the view.
* The VR session stays active without an error.

### ✅ Test successful if:

**Kinesis opens → Quest 3S connects → VR starts → 3D workspace appears inside the headset.**
