using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Chime.Api.Tests;

public class CorsTests(ApiFactory factory) : IClassFixture<ApiFactory> {
  [Theory]
  [InlineData("https://chime.dev.fergl.ie:3000", true)]
  [InlineData("https://unrelated.example:3000", false)]
  public async Task Google_login_preflight_uses_development_origin_allowlist(string origin, bool allowed) {
    var contentRoot = factory.Services.GetRequiredService<IWebHostEnvironment>().ContentRootPath;
    var configuration = new ConfigurationBuilder()
      .AddJsonFile(Path.Combine(contentRoot, "appsettings.Development.json"))
      .Build();
    using var configured = factory.WithWebHostBuilder(builder => {
      foreach (var entry in configuration.GetSection("Cors:AllowedOrigins").GetChildren()) {
        builder.UseSetting(entry.Path, entry.Value!);
      }
    });
    using var client = configured.CreateClient();
    using var request = new HttpRequestMessage(HttpMethod.Options, "/api/auth/google");
    request.Headers.Add("Origin", origin);
    request.Headers.Add("Access-Control-Request-Method", "POST");
    request.Headers.Add("Access-Control-Request-Headers", "content-type");

    using var response = await client.SendAsync(request);

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    if (allowed) {
      Assert.Equal(origin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
      Assert.Contains("POST", response.Headers.GetValues("Access-Control-Allow-Methods"));
      Assert.Contains("content-type", response.Headers.GetValues("Access-Control-Allow-Headers"));
    } else {
      Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }
  }
}
