using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

namespace JamMusic.Services;

public sealed class AudioEngineService : IAsyncDisposable
{
    private readonly IJSRuntime _js;
    private readonly PlaybackState _playback;
    private IJSObjectReference? _module;
    private DotNetObjectReference<AudioEngineService>? _self;
    private bool _disposed;

    public AudioEngineService(IJSRuntime js, PlaybackState playback)
    {
        _js = js;
        _playback = playback;
    }

    public async Task InitializeAsync(ElementReference audioElement, ElementReference canvasElement)
    {
        await EnsureModuleAsync();
        await _module!.InvokeVoidAsync("initialize", audioElement, canvasElement, _self, _playback.Volume);
    }

    public async Task AttachFileInputAsync(ElementReference fileInput)
    {
        await EnsureModuleAsync();
        await _module!.InvokeVoidAsync("attachFileInput", fileInput);
    }

    public async Task PlayAsync()
    {
        if (_module is null)
        {
            return;
        }

        await _module.InvokeVoidAsync("play");
    }

    public async Task PauseAsync()
    {
        if (_module is null)
        {
            return;
        }

        await _module.InvokeVoidAsync("pause");
    }

    public async Task TogglePlayAsync()
    {
        if (_playback.IsPlaying)
        {
            await PauseAsync();
            return;
        }

        await PlayAsync();
    }

    public async Task SeekAsync(double seconds)
    {
        if (_module is null)
        {
            return;
        }

        await _module.InvokeVoidAsync("seek", seconds);
    }

    public async Task SetVolumeAsync(double volume)
    {
        _playback.SetVolume(volume);
        if (_module is null)
        {
            return;
        }

        await _module.InvokeVoidAsync("setVolume", _playback.Volume);
    }

    public async Task StopAsync()
    {
        if (_module is null)
        {
            return;
        }

        try
        {
            await _module.InvokeVoidAsync("dispose");
            _playback.Reset();
        }
        catch (JSDisconnectedException)
        {
            _playback.Reset();
        }
        catch (ObjectDisposedException)
        {
            _playback.Reset();
        }
    }

    [JSInvokable]
    public void OnLoading(string fileName) => _playback.BeginLoading(fileName);

    [JSInvokable]
    public void OnReady(double durationSeconds, string title) => _playback.MarkReady(durationSeconds, title);

    [JSInvokable]
    public void OnPlay() => _playback.MarkPlaying();

    [JSInvokable]
    public void OnPause() => _playback.MarkPaused();

    [JSInvokable]
    public void OnEnded() => _playback.MarkEnded();

    [JSInvokable]
    public void OnTimeUpdate(double currentSeconds, double durationSeconds) =>
        _playback.SetTimes(currentSeconds, durationSeconds);

    [JSInvokable]
    public void OnError(string message) => _playback.MarkError(message);

    [JSInvokable]
    public void OnSelectionError(string message) => _playback.MarkSelectionError(message);

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        await StopAsync();
        if (_module is not null)
        {
            try
            {
                await _module.DisposeAsync();
            }
            catch (JSDisconnectedException)
            {
            }
            catch (ObjectDisposedException)
            {
            }

            _module = null;
        }

        _self?.Dispose();
        _self = null;
    }

    private async Task EnsureModuleAsync()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        _module ??= await _js.InvokeAsync<IJSObjectReference>("import", "./js/audioEngine.js");
        _self ??= DotNetObjectReference.Create(this);
    }
}
