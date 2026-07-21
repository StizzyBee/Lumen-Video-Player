using System;
using System.Runtime.InteropServices;

internal static class Program
{
    private const int GWL_STYLE = -16;
    private const int GWL_EXSTYLE = -20;
    private const int GWLP_HWNDPARENT = -8;

    private const long WS_CHILD = 0x40000000L;
    private const long WS_POPUP = 0x80000000L;
    private const long WS_VISIBLE = 0x10000000L;
    private const long WS_OVERLAPPEDWINDOW = 0x00CF0000L;
    private const long WS_CLIPCHILDREN = 0x02000000L;
    private const long WS_CLIPSIBLINGS = 0x04000000L;

    private const long WS_EX_APPWINDOW = 0x00040000L;
    private const long WS_EX_TOOLWINDOW = 0x00000080L;
    private const long WS_EX_NOACTIVATE = 0x08000000L;

    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_FRAMECHANGED = 0x0020;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const int SW_HIDE = 0;
    private const int SW_SHOWNOACTIVATE = 4;
    private static readonly IntPtr HWND_TOP = IntPtr.Zero;

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
        Console.Out.WriteLine(video.ToInt64());
        Console.Out.Flush();

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
        style |= WS_POPUP | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
        SetWindowLongPtr(video, GWL_STYLE, new IntPtr(style));

        long exStyle = GetWindowLongPtr(video, GWL_EXSTYLE).ToInt64();
        exStyle &= ~WS_EX_APPWINDOW;
        exStyle |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        SetWindowLongPtr(video, GWL_EXSTYLE, new IntPtr(exStyle));

        // For a top-level window, GWLP_HWNDPARENT assigns an owner rather than
        // creating a child. The layer follows Lumen in z-order, minimization,
        // and task switching without becoming a second user-facing window.
        SetWindowLongPtr(video, GWLP_HWNDPARENT, owner);
    }

    private static void PositionOverlay(IntPtr video, int x, int y, int width, int height)
    {
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
}
