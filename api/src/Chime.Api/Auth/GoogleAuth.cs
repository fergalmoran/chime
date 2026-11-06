using System.ComponentModel.DataAnnotations;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Authentication.BearerToken;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Chime.Api.Data;

namespace Chime.Api.Auth;

public sealed class GoogleAuthOptions
{
    /// <summary>OAuth client IDs (web, Android, ...) whose ID tokens are accepted as the audience.</summary>
    public string[] ClientIds { get; set; } = [];
}

public sealed record GoogleIdentity(string Subject, string Email, bool EmailVerified);

public interface IGoogleTokenValidator
{
    /// <returns>The identity, or null when the token is invalid.</returns>
    Task<GoogleIdentity?> ValidateAsync(string idToken, CancellationToken cancellationToken);
}

public sealed class GoogleTokenValidator(IOptions<GoogleAuthOptions> options, ILogger<GoogleTokenValidator> logger)
    : IGoogleTokenValidator
{
    public async Task<GoogleIdentity?> ValidateAsync(string idToken, CancellationToken cancellationToken)
    {
        try
        {
            var payload = await GoogleJsonWebSignature.ValidateAsync(idToken,
                new GoogleJsonWebSignature.ValidationSettings { Audience = options.Value.ClientIds });
            return payload.Email is null ? null : new GoogleIdentity(payload.Subject, payload.Email, payload.EmailVerified);
        }
        // Malformed tokens surface as assorted parse exceptions, not just InvalidJwtException.
        // Network failures fetching Google's signing keys are left to propagate as server errors.
        catch (Exception ex) when (ex is not (HttpRequestException or OperationCanceledException))
        {
            logger.LogInformation("Rejected Google ID token: {Reason}", ex.Message);
            return null;
        }
    }
}

public sealed record GoogleLoginRequest([Required, StringLength(8192, MinimumLength = 1)] string IdToken);

public static class GoogleAuthEndpoints
{
    public const string LoginProvider = "Google";

    public static RouteGroupBuilder MapGoogleAuth(this RouteGroupBuilder auth)
    {
        // Exchanges a Google ID token for bearer/refresh tokens. This is the only way to sign in.
        auth.MapPost("/google", async Task<Results<EmptyHttpResult, ProblemHttpResult>> (
            GoogleLoginRequest request,
            IOptions<GoogleAuthOptions> options,
            IGoogleTokenValidator validator,
            UserManager<AppUser> users,
            SignInManager<AppUser> signIn,
            CancellationToken cancellationToken) =>
        {
            if (options.Value.ClientIds.Length == 0)
            {
                return TypedResults.Problem("Google sign-in is not configured.", statusCode: StatusCodes.Status501NotImplemented);
            }

            var identity = await validator.ValidateAsync(request.IdToken, cancellationToken);
            if (identity is null)
            {
                return TypedResults.Problem("Invalid Google credential.", statusCode: StatusCodes.Status401Unauthorized);
            }

            var user = await users.FindByLoginAsync(LoginProvider, identity.Subject);
            if (user is null)
            {
                if (!identity.EmailVerified)
                {
                    return TypedResults.Problem("Google account email is not verified.", statusCode: StatusCodes.Status401Unauthorized);
                }

                user = await users.FindByEmailAsync(identity.Email);
                if (user is null)
                {
                    user = new AppUser { UserName = identity.Email, Email = identity.Email, EmailConfirmed = true };
                    var created = await users.CreateAsync(user);
                    if (!created.Succeeded)
                    {
                        return TypedResults.Problem(string.Join(" ", created.Errors.Select(e => e.Description)),
                            statusCode: StatusCodes.Status400BadRequest);
                    }
                }

                var linked = await users.AddLoginAsync(user, new UserLoginInfo(LoginProvider, identity.Subject, LoginProvider));
                if (!linked.Succeeded)
                {
                    return TypedResults.Problem(string.Join(" ", linked.Errors.Select(e => e.Description)),
                        statusCode: StatusCodes.Status400BadRequest);
                }
            }

            if (await users.IsLockedOutAsync(user))
            {
                return TypedResults.Problem("Account is locked.", statusCode: StatusCodes.Status401Unauthorized);
            }

            signIn.AuthenticationScheme = IdentityConstants.BearerScheme;
            await signIn.SignInAsync(user, isPersistent: false);
            // The bearer handler has already written the token response.
            return TypedResults.Empty;
        }).AllowAnonymous();

        // Mirrors MapIdentityApi's /refresh without exposing its password endpoints.
        auth.MapPost("/refresh", async Task<Results<SignInHttpResult, ChallengeHttpResult>> (
            RefreshRequest request,
            IOptionsMonitor<BearerTokenOptions> bearerOptions,
            SignInManager<AppUser> signIn,
            TimeProvider time) =>
        {
            var protector = bearerOptions.Get(IdentityConstants.BearerScheme).RefreshTokenProtector;
            var ticket = protector.Unprotect(request.RefreshToken);
            if (ticket?.Properties.ExpiresUtc is not { } expiresUtc
                || time.GetUtcNow() >= expiresUtc
                || await signIn.ValidateSecurityStampAsync(ticket.Principal) is not { } user)
            {
                return TypedResults.Challenge();
            }

            var principal = await signIn.CreateUserPrincipalAsync(user);
            return TypedResults.SignIn(principal, authenticationScheme: IdentityConstants.BearerScheme);
        }).AllowAnonymous();

        return auth;
    }
}

public sealed record RefreshRequest([Required] string RefreshToken);
