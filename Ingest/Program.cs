namespace Ingest
{
    using System;
    using System.Net;
    using Ingest.Handlers;
    using Microsoft.Extensions.Logging;
    using Microsoft.AspNetCore.Builder;
    using Microsoft.AspNetCore.Hosting;
    using Microsoft.Extensions.DependencyInjection;
    using LiveStreamingServerNet;
    using LiveStreamingServerNet.Networking;
    using LiveStreamingServerNet.Utilities.Contracts;
    using LiveStreamingServerNet.StreamProcessor.Contracts;
    using LiveStreamingServerNet.StreamProcessor.Hls.Contracts;
    using LiveStreamingServerNet.StreamProcessor.Installer;
    using LiveStreamingServerNet.StreamProcessor.AspNetCore.Installer;
    using LiveStreamingServerNet.StreamProcessor.AspNetCore.Configurations;
    using LiveStreamingServerNet.Networking.Server.Contracts;
    using Newtonsoft.Json;

    class Program
    {
        //public static Dictionary<string, string> mapTo = new();
        public static Config? config;
        public static HttpClient? client;
        public static IServer? server;
        static void Main(string[] args)
        {
            config = LoadConfig.GetConfig();
            client = new HttpClient()
            {
                BaseAddress = new Uri($"http://{config.Endpoints.Main}/"),
            };
            client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("ingest", config.Token);

            //string configPath = Path.Combine(Directory.GetCurrentDirectory(), "config.json");
            //httpClients = new HttpClients(new Uri(config.Endpoints.API_URL), config.Token);

            Console.WriteLine("Hello, World!");
            //Task.Run(async () => Server());
            Server();
            Console.ReadLine();
        }
        public static void Server()
        {
            var outputDir = Path.Combine(Directory.GetCurrentDirectory(), "hls-output");
            
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseUrls("http://0.0.0.0:8645");

            //var mainServer = WebApplication.CreateBuilder();
            //mainServer.WebHost.UseUrls("http://0.0.0.0:8080"); //Random address and port to be remapped

            var endPoints = new List<ServerEndPoint> {
                new(new IPEndPoint(IPAddress.Any, 1935), IsSecure: false),
                new(new IPEndPoint(IPAddress.Any, 444), IsSecure: true)
            };
            /*
            mainServer.Services.Configure<FormOptions>(x => {
                x.ValueCountLimit = Int32.MaxValue; //temp
                x.KeyLengthLimit = Int32.MaxValue;  //temp
            });
            mainServer.Services.AddProxies();
            */
            builder.Services.AddCors();

            builder.Services.AddLiveStreamingServer(endPoints, options =>
            {
                options.AddStreamEventHandler<RtmpStreamHandlerA>();
                options.AddAuthorizationHandler<AuthorizationHandler>();
                //For lowest latancy, found that setting frame interval to 1s greatly reduces it
                options.AddVideoCodecFilter(builder => builder.Include(LiveStreamingServerNet.Rtmp.VideoCodec.AVC).Include(LiveStreamingServerNet.Rtmp.VideoCodec.AV1));
                options.AddStreamProcessor(options => options.AddStreamProcessorEventHandler<HlsTransmuxerEventListener>())
                  .AddHlsTransmuxer(options => options.OutputPathResolver = new HlsTransmuxerOutputPathResolver(outputDir));
            });
            //mainServer.Services.AddCors();
            var app = builder.Build();
            //var server = mainServer.Build();
            app.UseCors(x => x.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
            app.UseHlsFiles(new HlsServingOptions
            {
                Root = outputDir,
                RequestPath = "/hls"
            });
            //app.UseWebSockets();

            //app.UseWebSocketFlv();

            //app.UseHttpFlv();

            Task task = Task.Run(() => app.Run());
            //Task task1 = Task.Run(() => server.Run());
            server = app.Services.GetService<IServer>();
            //if (server == null) throw new NullReferenceException();
        }

        public class HlsTransmuxerOutputPathResolver(string outputDir) : IHlsOutputPathResolver
        {
            private readonly string _outputDir = outputDir;

            public ValueTask<string> ResolveOutputPath(IServiceProvider services, Guid contextIdentifier, string streamPath, IReadOnlyDictionary<string, string> streamArguments)
            {
                return ValueTask.FromResult(Path.Combine(_outputDir, contextIdentifier.ToString(), "output.m3u8"));
            }
        }

        public class HlsTransmuxerEventListener(ILogger<Program.HlsTransmuxerEventListener> logger) : IStreamProcessorEventHandler
        {
            private readonly ILogger _logger = logger;

            public Task OnStreamProcessorStartedAsync(IEventContext context, string transmuxer, Guid identifier, uint clientId, string inputPath, string outputPath, string streamPath, IReadOnlyDictionary<string, string> streamArguments)
            {
                //Warning disabled because OnStreamProcessStartedAsync shouldn't be called if the server is not defined
#pragma warning disable CS8602 // Dereference of a possibly null reference.
                server.GetClient(clientId).HLS = identifier;
#pragma warning restore CS8602 // Dereference of a possibly null reference.
                _logger.LogInformation($"[{identifier}] Transmuxer {transmuxer} started: {inputPath} -> {outputPath}");
                return Task.CompletedTask;
            }

            public Task OnStreamProcessorStoppedAsync(IEventContext context, string transmuxer, Guid identifier, uint clientId, string inputPath, string outputPath, string streamPath, IReadOnlyDictionary<string, string> streamArguments)
            {
                _logger.LogInformation($"[{identifier}] Transmuxer {transmuxer} stopped: {inputPath} -> {outputPath}");
                return Task.CompletedTask;
            }
        }
    }
}