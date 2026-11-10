using System.Net;
using System.Net.Http.Headers;
using Chime.Api.Auth;
using Chime.Api.Contracts;
using Chime.Api.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Chime.Api.Tests;

public class GoogleAuthTests(ApiFactory factory) : IClassFixture<ApiFactory> {
  [Fact]
  public async Task New_google_user_is_created_and_receives_tokens() {
    var email = $"g-{Guid.NewGuid():N}@gmail.com";
    var (status, me) = await SignInAsync($"sub-{Guid.NewGuid():N}|{email}|true");

    Assert.Equal(HttpStatusCode.OK, status);
    Assert.Equal(email, me!.Email);
  }

  [Fact]
  public async Task Google_sign_in_links_to_existing_account_by_verified_email() {
    // e.g. accounts created before sign-in became Google-only.
    var email = $"p-{Guid.NewGuid():N}@example.com";
    var existing = new AppUser {UserName = email, Email = email};
    using (var scope = factory.Services.CreateScope()) {
      var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
      Assert.True((await users.CreateAsync(existing, "Sup3r-secret!")).Succeeded);
    }

    var subject = $"sub-{Guid.NewGuid():N}";
    var (_, linked) = await SignInAsync($"{subject}|{email}|true");
    // Later sign-ins resolve by Google subject, even if the Google email changes.
    var (_, again) = await SignInAsync($"{subject}|changed-{email}|true");

    Assert.Equal(existing.Id, linked!.Id);
    Assert.Equal(existing.Id, again!.Id);
  }

  [Theory]
  [InlineData("/api/auth/register")]
  [InlineData("/api/auth/login")]
  public async Task Password_endpoints_are_not_exposed(string path) {
    var response = await factory.CreateClient()
      .PostAsJsonAsync(path, new {email = "a@b.com", password = "Sup3r-secret!"});
    Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
  }

  [Fact]
  public async Task Refresh_token_issues_new_tokens_and_rejects_garbage() {
    var email = $"r-{Guid.NewGuid():N}@gmail.com";
    var (_, tokens) = await factory.SignInWithGoogleAsync($"sub-{email}|{email}|true");
    var client = factory.CreateClient();

    var refreshed = await client.PostAsJsonAsync("/api/auth/refresh", new {tokens.RefreshToken});
    var bogus = await client.PostAsJsonAsync("/api/auth/refresh", new {refreshToken = "garbage"});

    Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
    var fresh = await refreshed.Content.ReadFromJsonAsync<ApiFactory.TokenResponse>();
    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", fresh!.AccessToken);
    Assert.Equal(email, (await client.GetFromJsonAsync<MeResponse>("/api/me"))!.Email);
    Assert.Equal(HttpStatusCode.Unauthorized, bogus.StatusCode);
  }

  [Theory]
  [InlineData("not-a-valid-token")]
  [InlineData("sub-unverified|unverified@example.com|false")]
  public async Task Invalid_or_unverified_credentials_are_rejected(string idToken) {
    var (status, _) = await SignInAsync(idToken);
    Assert.Equal(HttpStatusCode.Unauthorized, status);
  }

  [Fact]
  public async Task Google_sign_in_is_unavailable_when_not_configured() {
    using var unconfigured = new UnconfiguredGoogleApiFactory();
    var response = await unconfigured.CreateClient()
      .PostAsJsonAsync("/api/auth/google", new {idToken = "x|y@z.com|true"});
    Assert.Equal(HttpStatusCode.NotImplemented, response.StatusCode);
  }

  [Theory]
  [InlineData("not-a-jwt")]
  [InlineData("fake.jwt.token")]
  [InlineData("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln")]
  public async Task Real_validator_rejects_malformed_tokens(string idToken) {
    var validator = new GoogleTokenValidator(
      Options.Create(new GoogleAuthOptions {ClientIds = ["test-client-id"]}),
      NullLogger<GoogleTokenValidator>.Instance);

    Assert.Null(await validator.ValidateAsync(idToken, CancellationToken.None));
  }

  private async Task<(HttpStatusCode Status, MeResponse? Me)> SignInAsync(string idToken) {
    var client = factory.CreateClient();
    var response = await client.PostAsJsonAsync("/api/auth/google", new {idToken});
    if (!response.IsSuccessStatusCode) return (response.StatusCode, null);

    var tokens = await response.Content.ReadFromJsonAsync<ApiFactory.TokenResponse>();
    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens!.AccessToken);
    return (response.StatusCode, await client.GetFromJsonAsync<MeResponse>("/api/me"));
  }
}
