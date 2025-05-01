using LiveStreamingServerNet.Networking.Contracts;
using LiveStreamingServerNet.Rtmp.Server.Auth;
using LiveStreamingServerNet.Rtmp.Server.Auth.Contracts;
using Newtonsoft.Json;
using System.Text;
using Ingest.JSON;

namespace Ingest.Handlers
{
    public class AuthorizationHandler : IAuthorizationHandler
    {
        public async Task<AuthorizationResult> AuthorizePublishingAsync(ISessionInfo client, string streamPath, IReadOnlyDictionary<string, string> streamArguments, string publishingType)
        {
            try
            {
                var key = streamPath[1..].Split('/')[1];
                if (Program.client != null)
                {
                    using StringContent JSONContent = new(JsonConvert.SerializeObject(new
                    {
                        key
                    }), Encoding.UTF8,
                    "application/json");
                    var a = await Program.client.PostAsync("key/", JSONContent);
                    if (a.StatusCode == System.Net.HttpStatusCode.OK)
                    {
                        var jsonResponse = await a.Content.ReadAsStringAsync();
                        var response = JsonConvert.DeserializeObject<JsonObjects.API.KeyReponse>(jsonResponse);
                        client.Path = $"/live/{response?.url}";
                        return AuthorizationResult.Authorized();
                    }
                    else return AuthorizationResult.Unauthorized("Not Allowed");
                }
                else return AuthorizationResult.Unauthorized("Server Error");
            }
            catch (Exception ex)
            {
                Console.WriteLine(ex);
                return AuthorizationResult.Unauthorized("Server Error");
            }
            //return AuthorizationResult.Unauthorized("incorrect password");
        }

        public Task<AuthorizationResult> AuthorizeSubscribingAsync(ISessionInfo client,string streamPath,IReadOnlyDictionary<string, string> streamArguments)
        {
            return Task.FromResult(AuthorizationResult.Authorized());
        }
    }
}
