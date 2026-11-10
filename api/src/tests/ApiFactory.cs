using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Chime.Api.Auth;

namespace Chime.Api.Tests;

public class ApiFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"chime-test-{Guid.NewGuid():N}.db");

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", $"Data Source={_dbPath};Pooling=false");
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.ConfigureTestServices(services =>
        {
            services.PostConfigure<GoogleAuthOptions>(o => o.ClientIds = GoogleConfigured ? ["test-client-id"] : []);
            services.AddSingleton<IGoogleTokenValidator, FakeGoogleValidator>();
        });
    }

    protected virtual bool GoogleConfigured => true;

    /// <summary>Signs in through /api/auth/google with a fake token of the form "sub|email|verified".</summary>
    public async Task<(HttpClient Client, TokenResponse Tokens)> SignInWithGoogleAsync(string idToken)
    {
        var client = CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/google", new { idToken });
        response.EnsureSuccessStatusCode();
        var tokens = await response.Content.ReadFromJsonAsync<TokenResponse>(Json);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens!.AccessToken);
        return (client, tokens);
    }

    public async Task<(HttpClient Client, string AccessToken)> CreateAuthenticatedClientAsync(string? email = null)
    {
        email ??= $"user-{Guid.NewGuid():N}@example.com";
        var (client, tokens) = await SignInWithGoogleAsync($"sub-{email}|{email}|true");
        return (client, tokens.AccessToken);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (File.Exists(_dbPath)) File.Delete(_dbPath);
    }

    public sealed record TokenResponse(string AccessToken, string RefreshToken);

    private sealed class FakeGoogleValidator : IGoogleTokenValidator
    {
        public Task<GoogleIdentity?> ValidateAsync(string idToken, CancellationToken cancellationToken)
        {
            var parts = idToken.Split('|');
            return Task.FromResult(parts.Length == 3
                ? new GoogleIdentity(parts[0], parts[1], bool.Parse(parts[2]))
                : null);
        }
    }
}

public sealed class UnconfiguredGoogleApiFactory : ApiFactory
{
    protected override bool GoogleConfigured => false;
}
