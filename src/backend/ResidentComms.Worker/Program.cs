using ResidentComms.Infrastructure.Sql;
using ResidentComms.Worker.Dispatch;
using ResidentComms.Worker.Providers;

// Standalone worker host. Secrets (connection string if not Windows auth, Providers:MockSms:SigningKey) come from
// user-secrets or environment variables, never from the repo:
//   dotnet user-secrets set "Providers:MockSms:SigningKey" "<random 32+ byte string>" --project src/backend/ResidentComms.Worker
var builder = Host.CreateApplicationBuilder(args);

var options = new MockSmsOptions();
builder.Configuration.GetSection("Providers:MockSms").Bind(options);
if (string.IsNullOrWhiteSpace(options.SigningKey) || System.Text.Encoding.UTF8.GetByteCount(options.SigningKey) < 32)
    throw new InvalidOperationException("Providers:MockSms:SigningKey is missing or shorter than 32 bytes (set it via user-secrets or the Providers__MockSms__SigningKey env var).");

builder.Services.AddSingleton(options);
builder.Services.AddSingleton(new SqlConnectionFactory(
    builder.Configuration.GetConnectionString("Default") ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.")));
builder.Services.AddHttpClient<IProviderEventPoster, HttpProviderEventPoster>(c => c.BaseAddress = new Uri(options.CallbackBaseUrl));
builder.Services.AddSingleton<ISmsAdapter, MockSmsAdapter>();
builder.Services.AddHostedService<OutboxDispatcher>();

builder.Build().Run();
