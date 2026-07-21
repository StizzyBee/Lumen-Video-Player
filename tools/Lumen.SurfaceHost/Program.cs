using System;
using System.Runtime.InteropServices;
using System.Threading;

internal static class Program
{
    private const uint WS_CHILD = 0x40000000;
    private const uint WS_VISIBLE = 0x10000000;
    private const uint SS_BLACKRECT = 0x00000004;

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        public IntPtr Window;
        public uint Id;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public Point Cursor;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(
        uint extendedStyle,
        string className,
        string windowName,
        uint style,
        int x,
        int y,
        int width,
        int height,
        IntPtr parent,
        IntPtr menu,
        IntPtr instance,
        IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool repaint);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage([In] ref Message message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage([In] ref Message message);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    private static int Main(string[] args)
    {
        long parentValue;
        int x;
        int y;
        int width;
        int height;
        if (args.Length != 5 ||
            !long.TryParse(args[0], out parentValue) ||
            !int.TryParse(args[1], out x) ||
            !int.TryParse(args[2], out y) ||
            !int.TryParse(args[3], out width) ||
            !int.TryParse(args[4], out height))
        {
            return 2;
        }

        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }

        IntPtr surface = CreateWindowEx(
            0,
            "STATIC",
            "Lumen video surface",
            WS_CHILD | WS_VISIBLE | SS_BLACKRECT,
            x,
            y,
            Math.Max(1, width),
            Math.Max(1, height),
            new IntPtr(parentValue),
            IntPtr.Zero,
            IntPtr.Zero,
            IntPtr.Zero);

        if (surface == IntPtr.Zero) return 3;

        Console.Out.WriteLine(surface.ToInt64());
        Console.Out.Flush();

        var input = new Thread(() => ReadCommands(surface)) { IsBackground = true };
        input.Start();

        Message message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
        return 0;
    }

    private static void ReadCommands(IntPtr surface)
    {
        try
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                string[] parts = line.Split(' ');
                int x;
                int y;
                int width;
                int height;
                if (parts.Length == 4 &&
                    int.TryParse(parts[0], out x) &&
                    int.TryParse(parts[1], out y) &&
                    int.TryParse(parts[2], out width) &&
                    int.TryParse(parts[3], out height))
                {
                    MoveWindow(surface, x, y, Math.Max(1, width), Math.Max(1, height), true);
                }
            }
        }
        finally
        {
            Environment.Exit(0);
        }
    }
}
