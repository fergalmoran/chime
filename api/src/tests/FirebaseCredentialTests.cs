using System.Security.Cryptography;
using System.Text.Json;
using Chime.Api.Services;
using Google.Apis.Auth.OAuth2;
using Microsoft.Extensions.Options;

namespace Chime.Api.Tests;

public class FirebaseCredentialTests {
  [Fact]
  public async Task Configured_credentials_are_loaded_from_memory_and_scoped_for_messaging() {
    var credential = await MobileLinkSender.CreateCredentialAsync(new FirebaseOptions {
      ProjectId = "test-project",
      CredentialsJson = CreateServiceAccountJson()
    }, AppContext.BaseDirectory);

    var serviceAccount = Assert.IsType<ServiceAccountCredential>(credential.UnderlyingCredential);
    Assert.Equal("sender@test-project.iam.gserviceaccount.com", serviceAccount.Id);
    Assert.Contains("https://www.googleapis.com/auth/firebase.messaging", serviceAccount.Scopes);
  }

  [Theory]
  [InlineData("")]
  [InlineData("not-json-test-sensitive-marker")]
  [InlineData("""{"type":"authorized_user","client_secret":"test-sensitive-marker"}""")]
  [InlineData("""{"type":"service_account","private_key":"test-sensitive-marker"}""")]
  public async Task Invalid_explicit_configuration_is_rejected_without_falling_back_or_exposing_secrets(string json) {
    var error = await Assert.ThrowsAsync<OptionsValidationException>(() =>
      MobileLinkSender.CreateCredentialAsync(new FirebaseOptions {CredentialsJson = json}, AppContext.BaseDirectory));

    Assert.Contains("Firebase:CredentialsJson", error.Message);
    Assert.DoesNotContain("test-sensitive-marker", error.ToString());
  }

  [Theory]
  [InlineData(true)]
  [InlineData(false)]
  public async Task Configured_file_loads_with_absolute_or_content_root_relative_path(bool relative) {
    var root = Directory.CreateTempSubdirectory("chime-firebase-tests-");
    var path = Path.Combine(root.FullName, "credentials.json");
    try {
      await File.WriteAllTextAsync(path, CreateServiceAccountJson());
      var credential = await MobileLinkSender.CreateCredentialAsync(new FirebaseOptions {
        CredentialsFilePath = relative ? "credentials.json" : path
      }, root.FullName);

      var serviceAccount = Assert.IsType<ServiceAccountCredential>(credential.UnderlyingCredential);
      Assert.Equal("sender@test-project.iam.gserviceaccount.com", serviceAccount.Id);
      Assert.Contains("https://www.googleapis.com/auth/firebase.messaging", serviceAccount.Scopes);
    } finally {
      File.Delete(path);
      root.Delete();
    }
  }

  [Fact]
  public async Task Missing_file_is_a_configuration_error_without_adc_fallback() {
    var error = await Assert.ThrowsAsync<OptionsValidationException>(() =>
      MobileLinkSender.CreateCredentialAsync(new FirebaseOptions {
        CredentialsFilePath = $"missing-{Guid.NewGuid():N}.json"
      }, Path.GetTempPath()));
    Assert.Contains("Firebase:CredentialsFilePath", error.Message);
    Assert.Contains("readable", error.Message);
  }

  [Fact]
  public async Task Invalid_file_is_a_configuration_error_without_disclosing_its_contents() {
    var path = Path.GetTempFileName();
    try {
      await File.WriteAllTextAsync(path, "test-sensitive-marker");
      var error = await Assert.ThrowsAsync<OptionsValidationException>(() =>
        MobileLinkSender.CreateCredentialAsync(new FirebaseOptions {CredentialsFilePath = path}, Path.GetTempPath()));
      Assert.Contains("Firebase:CredentialsFilePath", error.Message);
      Assert.DoesNotContain("test-sensitive-marker", error.ToString());
    } finally {
      File.Delete(path);
    }
  }

  [Fact]
  public async Task Conflicting_explicit_sources_are_rejected() {
    var error = await Assert.ThrowsAsync<OptionsValidationException>(() =>
      MobileLinkSender.CreateCredentialAsync(new FirebaseOptions {
        CredentialsFilePath = "credentials.json",
        CredentialsJson = "test-sensitive-marker"
      }, Path.GetTempPath()));
    Assert.Contains("not both", error.Message);
    Assert.DoesNotContain("test-sensitive-marker", error.ToString());
  }

  private static string CreateServiceAccountJson() {
    using var key = RSA.Create(2048);
    return JsonSerializer.Serialize(new {
      type = "service_account",
      project_id = "test-project",
      private_key_id = "test-key",
      private_key = key.ExportPkcs8PrivateKeyPem(),
      client_email = "sender@test-project.iam.gserviceaccount.com",
      client_id = "123456789",
      token_uri = "https://oauth2.googleapis.com/token"
    });
  }
}
