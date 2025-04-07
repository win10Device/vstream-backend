using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Ingest
{
    public class Config
    {
        public class EndpointsList
        {
            public required string Main { get; set; }
            public required string Stats { get; set; }
            public bool https { get; set;  }
        }
        public string Id { get; set; } = string.Empty;
        public string Token { get; set; } = string.Empty;
        public required EndpointsList Endpoints { get; set; }

    }
    public static class LoadConfig
    {
        public static Config GetConfig()
        {
            string configPath = Path.Combine(Directory.GetCurrentDirectory(), "config.json");
            if (File.Exists(configPath))
                return JsonConvert.DeserializeObject<Config>(File.ReadAllText(configPath));
            else
            {
                var a = new Config
                {
                    Endpoints = new()
                    {
                        Main = "api.ranrom.net/test",
                        Stats = "api.ranrom.net/test",
                        https = true
                    }
                };
                File.WriteAllText(configPath, JsonConvert.SerializeObject(a));
                return a;
            }
        }
    }
}
