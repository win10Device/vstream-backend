﻿using LiveStreamingServerNet.StreamProcessor.Internal.Contracts;
using System.Collections.Concurrent;

namespace LiveStreamingServerNet.StreamProcessor.Internal.Hls.Services
{
    internal class HlsPathRegistry : IHlsPathRegistry
    {
        private readonly ConcurrentDictionary<string, string> _hlsManifestPaths;

        public HlsPathRegistry()
        {
            _hlsManifestPaths = new ConcurrentDictionary<string, string>();
        }
        // furina
        public bool RegisterHlsOutputPath(string streamPath, string outputPath)
        {
            return _hlsManifestPaths.TryAdd(NormalizePath(streamPath), NormalizePath(outputPath));
        }

        public void UnregisterHlsOutputPath(string streamPath)
        {
            _hlsManifestPaths.TryRemove(NormalizePath(streamPath), out _);
        }

        public string? GetHlsOutputPath(string streamPath)
        {
            Console.WriteLine("------------------------");
            Console.WriteLine(streamPath);
            Console.WriteLine("------------------------");
            return _hlsManifestPaths.TryGetValue(NormalizePath(streamPath), out var manifestPath) ? manifestPath : null;
        }

        private static string NormalizePath(string path)
        {
            return path.Replace('\\', '/').TrimEnd('/');
        }
    }
}
