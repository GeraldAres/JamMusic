namespace JamMusic.Services;

public static class PlaybackTime
{
    public static string Format(double seconds)
    {
        if (double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds < 0)
        {
            seconds = 0;
        }

        var totalSeconds = (int)Math.Floor(seconds);
        var hours = totalSeconds / 3600;
        var minutes = totalSeconds % 3600 / 60;
        var secs = totalSeconds % 60;

        return hours > 0
            ? $"{hours}:{minutes:D2}:{secs:D2}"
            : $"{minutes}:{secs:D2}";
    }
}
