using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.BearerToken;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Chime.Api.Auth;
using Chime.Api.Data;
using Chime.Api.Endpoints;
using Chime.Api.Hubs;
using Chime.Api.Services;

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
    if (!string.IsNullOrEmpty(token) && context.HttpContext.Request.Path.StartsWithSegments("/hubs")) {
      context.Token = token;
    }

    return Task.CompletedTask;
  };
});

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

app.MapGet("/health", () => TypedResults.Ok(new {status = "ok"})).AllowAnonymous();

app.MapGroup("/auth").WithTags("Auth").MapGoogleAuth();

app.MapGroup("/api")
  .RequireAuthorization()
  .MapAccountEndpoints()
  .MapDeviceEndpoints()
  .MapNotificationEndpoints();

app.MapHub<NotificationsHub>("/hubs/notifications");

app.Run();

public partial class Program;
