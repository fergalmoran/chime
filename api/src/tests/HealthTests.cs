using System.Net;
using System.Net.Http.Json;

namespace Chime.Api.Tests;

public class HealthTests(ApiFactory factory) : IClassFixture<ApiFactory> {
  [Fact]
  public async Task Health_returns_ok_and_the_build_version() {
    using var client = factory.CreateClient();

    using var response = await client.GetAsync("/api/health");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    var body = await response.Content.ReadFromJsonAsync<HealthResponse>(ApiFactory.Json);
    Assert.NotNull(body);
    Assert.Equal("ok", body.Status);
    Assert.False(string.IsNullOrWhiteSpace(body.Version));
    Assert.Equal(BuildInfo.Version, body.Version);
  }

  [Fact]
  public async Task Ping_returns_pong_without_signing_in() {
    using var client = factory.CreateClient();

    using var response = await client.GetAsync("/api/ping");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal("""{"message":"pong"}""", await response.Content.ReadAsStringAsync());
  }

  private sealed record HealthResponse(string Status, string Version);
}
