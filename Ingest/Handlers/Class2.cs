using LiveStreamingServerNet.Networking.Server.Contracts;
using LiveStreamingServerNet.Utilities.Contracts;
using System.Collections.Concurrent;
using System.Net.Http.Json;

namespace Ingest.Handlers
{

    public class RtmpStreamHandlerA(IServer server) : LiveStreamingServerNet.Rtmp.Server.Contracts.IRtmpServerStreamEventHandler, IDisposable
    {
        public static ConcurrentDictionary<string, ITimer> _clientTimers = new();
        private readonly IServer _server = server;

        public void Dispose()
        {
            foreach (var timer in _clientTimers.Values)
                timer.Dispose();

            _clientTimers.Clear();
        }
        //v
        public ValueTask OnRtmpStreamPublishedAsync(
            IEventContext context, uint clientId, string streamPath, IReadOnlyDictionary<string, string> streamArguments)
        {
            //Program.mapTo.Add($"{clientId}", streamPath.TrimStart('/').TrimEnd('/'));
            _clientTimers[streamPath] = new Timer(async _ =>
            {
                var client = _server.GetClient(clientId);
                //client.RemoteEndPoint. get client IP
                // Send to API that user reached qouta
                if (client != null)
                    await client.DisconnectAsync();
            }, null, TimeSpan.FromSeconds(3600 * 12), Timeout.InfiniteTimeSpan);

            return ValueTask.CompletedTask;
        }

        public ValueTask OnRtmpStreamUnpublishedAsync(IEventContext context, uint clientId, string streamPath)
        {
            //if (Program.mapTo.ContainsKey($"{clientId}"))
            //    Program.mapTo.Remove($"{clientId}");
            if (_clientTimers.TryRemove(streamPath, out var timer))
                timer.Dispose();
            var user = Program.server?.GetClient(clientId)?.Path.Replace("/live/",string.Empty);
            Program.client?.DeleteAsync($"key/{user}");
            return ValueTask.CompletedTask;
        }
        //
        public ValueTask OnRtmpStreamMetaDataReceivedAsync(IEventContext context, uint clientId, string streamPath, IReadOnlyDictionary<string, object> metaData)
        {
            return ValueTask.CompletedTask;
        }

        public ValueTask OnRtmpStreamSubscribedAsync(
            IEventContext context, uint clientId, string streamPath, IReadOnlyDictionary<string, string> streamArguments)
            => ValueTask.CompletedTask;

        public ValueTask OnRtmpStreamUnsubscribedAsync(IEventContext context, uint clientId, string streamPath)
            => ValueTask.CompletedTask;
    }
}
