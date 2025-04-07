using LiveStreamingServerNet.Networking.Server.Contracts;
using LiveStreamingServerNet.Rtmp.Server.Contracts;
using LiveStreamingServerNet.Utilities.Contracts;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Ingest.Handlers
{
    public class PublishingTimeLimiterConfig
    {
        public int PublishingTimeLimitSeconds { get; set; } = 10;
    }

    public class PublishingTimeLimiter : IRtmpServerStreamEventHandler, IDisposable
    {
        private readonly ConcurrentDictionary<uint, ITimer> _clientTimers = new();
        private readonly IServer _server;
        private readonly PublishingTimeLimiterConfig _config;

        public PublishingTimeLimiter(IServer server, IOptions<PublishingTimeLimiterConfig> config)
        {
            _server = server;
            _config = config.Value;
        }

        public void Dispose()
        {
            foreach (var timer in _clientTimers.Values)
                timer.Dispose();

            _clientTimers.Clear();
        }

        public ValueTask OnRtmpStreamPublishedAsync(
            IEventContext context, uint clientId, string streamPath, IReadOnlyDictionary<string, string> streamArguments)
        {
            _clientTimers[clientId] = new Timer(async _ =>
            {
                var client = _server.GetClient(clientId);

                if (client != null)
                    await client.DisconnectAsync();
            }, null, TimeSpan.FromSeconds(_config.PublishingTimeLimitSeconds), Timeout.InfiniteTimeSpan);

            return ValueTask.CompletedTask;
        }

        public ValueTask OnRtmpStreamUnpublishedAsync(IEventContext context, uint clientId, string streamPath)
        {
            if (_clientTimers.TryRemove(clientId, out var timer))
                timer.Dispose();

            return ValueTask.CompletedTask;
        }

        public ValueTask OnRtmpStreamMetaDataReceivedAsync(
            IEventContext context, uint clientId, string streamPath, IReadOnlyDictionary<string, object> metaData)
            => ValueTask.CompletedTask;

        public ValueTask OnRtmpStreamSubscribedAsync(
            IEventContext context, uint clientId, string streamPath, IReadOnlyDictionary<string, string> streamArguments)
            => ValueTask.CompletedTask;

        public ValueTask OnRtmpStreamUnsubscribedAsync(IEventContext context, uint clientId, string streamPath)
            => ValueTask.CompletedTask;
    }
}
