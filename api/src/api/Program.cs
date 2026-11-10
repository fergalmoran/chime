using System.Text.Json.Serialization;
using Chime.Api.Auth;
using Chime.Api.Data;
using Chime.Api.Endpoints;
using Chime.Api.Hubs;
using Chime.Api.Services;
using Microsoft.AspNetCore.Authentication.BearerToken;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
  options.UseSqlite(builder.Configuration.GetConnectionString("Default")));

builder.Services.AddAuthorization();
builder.Services
  // Google is the only sign-in method; Identity just stores users/logins and issues bearer tokens.
  .AddIdentityApiEndpoints<AppUser>(options => options.User.RequireUniqueEmail = true)
  .AddEntityFrameworkStores<AppDbContext>();

// Browsers can't set headers on WebSocket/SSE requests, so SignalR sends the bearer token in the query string.
builder.Services.Configure<BearerTokenOptions>(IdentityConstants.BearerScheme, options => {
  options.Events.OnMessageReceived = context => {
    var token = context.Request.Query["access_token"];
    if (!string.IsNullOrEmpty(token) && context.HttpContext.Request.Path.StartsWithSegments("/api/hubs")) {
      context.Token = token;
    }

    return Task.CompletedTask;
  };
});

// Bearer and refresh tokens are encrypted with Data Protection keys. Keep the key ring on a persistent volume
// in containers (DataProtection:KeysPath), or every restart/redeploy invalidates every signed-in session.
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("chime");
if (builder.Configuration["DataProtection:KeysPath"] is {Length: > 0} keysPath) {
  dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keysPath));
}

builder.Services.Configure<GoogleAuthOptions>(builder.Configuration.GetSection("Authentication:Google"));
builder.Services.AddSingleton<IGoogleTokenValidator, GoogleTokenValidator>();

builder.Services.ConfigureHttpJsonOptions(options =>
  options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSignalR().AddJsonProtocol(options =>
  options.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddValidation();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHostedService<RetentionService>();
builder.Services.Configure<FirebaseOptions>(builder.Configuration.GetSection("Firebase"));
builder.Services.AddHttpClient("Firebase", client => client.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddSingleton<IMobileLinkSender, MobileLinkSender>();
builder.Services.Configure<WebPushOptions>(builder.Configuration.GetSection("WebPush"));
builder.Services.AddHttpClient<IWebPushSender, WebPushSender>(client => client.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddSingleton<BrowserPushService>();
builder.Services.AddSingleton<IBrowserPushQueue>(sp => sp.GetRequiredService<BrowserPushService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<BrowserPushService>());

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
  .SetIsOriginAllowed(origin =>
    allowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase)
    || origin.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase)
    || origin.StartsWith("moz-extension://", StringComparison.OrdinalIgnoreCase))
  .AllowAnyHeader()
  .AllowAnyMethod()
  .AllowCredentials()));

var app = builder.Build();

if (app.Environment.IsDevelopment()) {
  app.MapOpenApi();
}

if (app.Configuration.GetValue("Database:MigrateOnStartup", false)) {
  await using var scope = app.Services.CreateAsyncScope();
  await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// Every route lives under /api so a reverse proxy can serve the API and web app from one origin
// (e.g. https://chime.ferg.al/api/* -> API, everything else -> web).
var api = app.MapGroup("/api");

api.MapGet("/health", () => TypedResults.Ok(new {status = "ok"})).AllowAnonymous();

api.MapGroup("/auth").WithTags("Auth").MapGoogleAuth();

api.MapGroup("")
  .RequireAuthorization()
  .RequireExistingUser()
  .MapAccountEndpoints()
  .MapDeviceEndpoints()
  .MapWebPushEndpoints()
  .MapNotificationEndpoints();

app.MapHub<NotificationsHub>("/api/hubs/notifications");

app.Run();

public partial class Program;
