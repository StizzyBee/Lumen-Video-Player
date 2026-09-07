using System;
using System.Runtime.InteropServices;
using System.Threading;

internal static class Program
{
    private const int GWL_STYLE = -16;
    private const int GWL_EXSTYLE = -20;
    private const int GWLP_HWNDPARENT = -8;

    private const long WS_CHILD = 0x40000000L;
    private const long WS_POPUP = 0x80000000L;
    private const long WS_VISIBLE = 0x10000000L;
    private const long WS_DISABLED = 0x08000000L;
    private const long WS_OVERLAPPEDWINDOW = 0x00CF0000L;
    private const long WS_CLIPCHILDREN = 0x02000000L;
    private const long WS_CLIPSIBLINGS = 0x04000000L;

    private const long WS_EX_APPWINDOW = 0x00040000L;
    private const long WS_EX_TOOLWINDOW = 0x00000080L;
    private const long WS_EX_NOACTIVATE = 0x08000000L;
    private const long WS_EX_TRANSPARENT = 0x00000020L;

    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_FRAMECHANGED = 0x0020;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const int SW_HIDE = 0;
    private const int SW_SHOWNOACTIVATE = 4;
    private const int VK_LBUTTON = 0x01;
    private static readonly IntPtr HWND_TOP = IntPtr.Zero;
    private static readonly object StateLock = new object();
    private static readonly object OutputLock = new object();
    private static int overlayX;
    private static int overlayY;
    private static int overlayWidth;
    private static int overlayHeight;
    private static volatile bool monitorPointer;

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr SetParent(IntPtr child, IntPtr parent);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        IntPtr window,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out Point point);

    private static int Main(string[] args)
    {
        long ownerValue;
        long videoValue;
        int x;
        int y;
        int width;
        int height;
        if (args.Length != 6 ||
            !long.TryParse(args[0], out ownerValue) ||
            !long.TryParse(args[1], out videoValue) ||
            !int.TryParse(args[2], out x) ||
            !int.TryParse(args[3], out y) ||
            !int.TryParse(args[4], out width) ||
            !int.TryParse(args[5], out height))
        {
            return 2;
        }

        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }

        IntPtr owner = new IntPtr(ownerValue);
        IntPtr video = new IntPtr(videoValue);
        if (!IsWindow(owner) || !IsWindow(video)) return 3;

        ConfigureOverlay(owner, video);
        PositionOverlay(video, x, y, width, height);
        WriteOutput(video.ToInt64().ToString());

        monitorPointer = true;
        Thread pointerThread = new Thread(MonitorPointer);
        pointerThread.IsBackground = true;
        pointerThread.Start();

        try
        {
            string line;
            while ((line = Console.In.ReadLine()) != null && IsWindow(owner) && IsWindow(video))
            {
                string[] parts = line.Split(' ');
                if (parts.Length == 4 &&
                    int.TryParse(parts[0], out x) &&
                    int.TryParse(parts[1], out y) &&
                    int.TryParse(parts[2], out width) &&
                    int.TryParse(parts[3], out height))
                {
                    PositionOverlay(video, x, y, width, height);
                }
            }
        }
        finally
        {
            monitorPointer = false;
            pointerThread.Join(100);
            if (IsWindow(video)) ShowWindow(video, SW_HIDE);
        }
        return 0;
    }

    private static void ConfigureOverlay(IntPtr owner, IntPtr video)
    {
        // MPV renders correctly as a top-level swapchain on virtual GPUs, but
        // goes black when Windows nests that swapchain inside another HWND.
        SetParent(video, IntPtr.Zero);

        long style = GetWindowLongPtr(video, GWL_STYLE).ToInt64();
        style &= ~(WS_CHILD | WS_OVERLAPPEDWINDOW);
        // A disabled top-level window still renders without taking focus.
        // Pointer gestures are observed below and relayed to Electron because
        // cross-process overlay windows cannot reliably pass hit tests through.
        style |= WS_POPUP | WS_VISIBLE | WS_DISABLED | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
        SetWindowLongPtr(video, GWL_STYLE, new IntPtr(style));

        long exStyle = GetWindowLongPtr(video, GWL_EXSTYLE).ToInt64();
        exStyle &= ~WS_EX_APPWINDOW;
        // The mpv HWND is only a picture layer. Keep it non-activating and
        // transparent in addition to disabling it so it cannot steal keyboard
        // focus from Lumen while showing video above Chromium.
        exStyle |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT;
        SetWindowLongPtr(video, GWL_EXSTYLE, new IntPtr(exStyle));

        // For a top-level window, GWLP_HWNDPARENT assigns an owner rather than
        // creating a child. The layer follows Lumen in z-order, minimization,
        // and task switching without becoming a second user-facing window.
        SetWindowLongPtr(video, GWLP_HWNDPARENT, owner);
    }

    private static void PositionOverlay(IntPtr video, int x, int y, int width, int height)
    {
        lock (StateLock)
        {
            overlayX = x;
            overlayY = y;
            overlayWidth = Math.Max(1, width);
            overlayHeight = Math.Max(1, height);
        }
        SetWindowPos(
            video,
            HWND_TOP,
            x,
            y,
            Math.Max(1, width),
            Math.Max(1, height),
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        ShowWindow(video, SW_SHOWNOACTIVATE);
    }

    private static void MonitorPointer()
    {
        bool wasDown = false;
        bool pressStartedInside = false;
        Point pressPoint = new Point();
        Point pendingPoint = new Point();
        long pendingClickAt = 0;

        while (monitorPointer)
        {
            Point cursor;
            bool haveCursor = GetCursorPos(out cursor);
            bool down = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;

            if (down && !wasDown)
            {
                pressStartedInside = haveCursor && IsInside(cursor);
                pressPoint = cursor;
            }
            else if (!down && wasDown)
            {
                if (pressStartedInside && haveCursor && IsInside(cursor) && DistanceSquared(pressPoint, cursor) <= 64)
                {
                    long now = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
                    if (pendingClickAt != 0 && now - pendingClickAt <= 300 && DistanceSquared(pendingPoint, cursor) <= 64)
                    {
                        pendingClickAt = 0;
                        WriteOutput("input double-click");
                    }
                    else
                    {
                        pendingClickAt = now;
                        pendingPoint = cursor;
                    }
                }
                pressStartedInside = false;
            }

            if (pendingClickAt != 0)
            {
                long now = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
                if (now - pendingClickAt > 300)
                {
                    pendingClickAt = 0;
                    WriteOutput("input click");
                }
            }

            wasDown = down;
            Thread.Sleep(15);
        }
    }

    private static bool IsInside(Point point)
    {
        lock (StateLock)
        {
            return point.X >= overlayX && point.X < overlayX + overlayWidth &&
                   point.Y >= overlayY && point.Y < overlayY + overlayHeight;
        }
    }

    private static int DistanceSquared(Point a, Point b)
    {
        int dx = a.X - b.X;
        int dy = a.Y - b.Y;
        return dx * dx + dy * dy;
    }

    private static void WriteOutput(string line)
    {
        lock (OutputLock)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }
}
