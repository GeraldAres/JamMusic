using JamMusic.Components.Sections;

namespace JamMusic.Services;

public sealed class PlaybackState
{
    public PlayerTrack Track { get; } = new();

    public PlaybackStatus Status { get; private set; } = PlaybackStatus.Idle;

    public bool IsPlaying => Status == PlaybackStatus.Playing;

    public double CurrentTimeSeconds { get; private set; }

    public double DurationSeconds { get; private set; }

    public double Volume { get; private set; } = 0.6;

    public string? ErrorMessage { get; private set; }

    public string? FileName { get; private set; }

    public event Action? Changed;

    public void BeginLoading(string fileName)
    {
        FileName = fileName;
        ErrorMessage = null;
        Status = PlaybackStatus.Loading;
        CurrentTimeSeconds = 0;
        DurationSeconds = 0;
        Track.Title = FormatTitle(fileName);
        Track.Artist = "Local file";
        Track.CurrentTime = PlaybackTime.Format(0);
        Track.TotalDuration = PlaybackTime.Format(0);
        Notify();
    }

    public void MarkReady(double durationSeconds, string? title = null)
    {
        DurationSeconds = ClampNonNegative(durationSeconds);
        CurrentTimeSeconds = 0;
        ErrorMessage = null;
        Status = PlaybackStatus.Ready;
        if (!string.IsNullOrWhiteSpace(title))
        {
            Track.Title = title.Trim();
        }

        Track.CurrentTime = PlaybackTime.Format(0);
        Track.TotalDuration = PlaybackTime.Format(DurationSeconds);
        Notify();
    }

    public void MarkPlaying()
    {
        ErrorMessage = null;
        Status = PlaybackStatus.Playing;
        Notify();
    }

    public void MarkPaused()
    {
        if (Status == PlaybackStatus.Error)
        {
            return;
        }

        Status = PlaybackStatus.Paused;
        Notify();
    }

    public void MarkEnded()
    {
        CurrentTimeSeconds = DurationSeconds;
        Track.CurrentTime = PlaybackTime.Format(CurrentTimeSeconds);
        Status = PlaybackStatus.Ended;
        Notify();
    }

    public void MarkError(string message)
    {
        Status = PlaybackStatus.Error;
        ErrorMessage = NormalizeError(message);
        Notify();
    }

    public void MarkSelectionError(string message)
    {
        ErrorMessage = NormalizeError(message);
        Notify();
    }

    public void SetTimes(double currentSeconds, double durationSeconds)
    {
        DurationSeconds = ClampNonNegative(durationSeconds);
        CurrentTimeSeconds = Math.Clamp(currentSeconds, 0, DurationSeconds > 0 ? DurationSeconds : Math.Max(currentSeconds, 0));
        Track.CurrentTime = PlaybackTime.Format(CurrentTimeSeconds);
        Track.TotalDuration = PlaybackTime.Format(DurationSeconds);
        Notify();
    }

    public void SetVolume(double volume)
    {
        Volume = Math.Clamp(volume, 0, 1);
        Notify();
    }

    public void Reset()
    {
        Status = PlaybackStatus.Idle;
        CurrentTimeSeconds = 0;
        DurationSeconds = 0;
        ErrorMessage = null;
        FileName = null;
        Track.Title = "No track selected";
        Track.Artist = string.Empty;
        Track.AudioSource = string.Empty;
        Track.CurrentTime = PlaybackTime.Format(0);
        Track.TotalDuration = PlaybackTime.Format(0);
        Notify();
    }

    public double ProgressPercent => DurationSeconds <= 0
        ? 0
        : Math.Clamp(CurrentTimeSeconds / DurationSeconds * 100, 0, 100);

    private void Notify() => Changed?.Invoke();

    private static string NormalizeError(string message) =>
        string.IsNullOrWhiteSpace(message)
            ? "This audio file could not be played."
            : message.Trim();

    private static double ClampNonNegative(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value) || value < 0)
        {
            return 0;
        }

        return value;
    }

    private static string FormatTitle(string fileName)
    {
        var name = Path.GetFileNameWithoutExtension(fileName);
        return string.IsNullOrWhiteSpace(name) ? "Local track" : name;
    }
}
