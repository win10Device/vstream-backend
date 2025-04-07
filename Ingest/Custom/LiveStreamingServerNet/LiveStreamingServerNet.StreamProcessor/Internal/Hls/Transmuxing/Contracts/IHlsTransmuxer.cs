﻿using LiveStreamingServerNet.Rtmp;
using LiveStreamingServerNet.StreamProcessor.Contracts;
using LiveStreamingServerNet.Utilities.Buffers.Contracts;

namespace LiveStreamingServerNet.StreamProcessor.Internal.Hls.Transmuxing.Contracts
{
    internal interface IHlsTransmuxer : IStreamProcessor
    {
        ValueTask AddMediaPacketAsync(MediaType mediaType, IRentedBuffer rentedBuffer, uint timestamp);
    }
}
