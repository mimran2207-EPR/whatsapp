using ResidentComms.Infrastructure.Sql;

string server = "localhost";
string? database = null;
bool seedDev = false;
for (var i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--server" when i + 1 < args.Length: server = args[++i]; break;
        case "--database" when i + 1 < args.Length: database = args[++i]; break;
        case "--seed-dev": seedDev = true; break;
        default:
            Console.Error.WriteLine($"Unknown or incomplete argument: {args[i]}");
            return 2;
    }
}
if (database is null)
{
    Console.Error.WriteLine("Usage: DbMigrator --database <name> [--server <host>] [--seed-dev]");
    return 2;
}

try
{
    if (seedDev && database != "whatsapp")
        throw new InvalidOperationException("--seed-dev is allowed only on database 'whatsapp'.");
    var runner = new MigrationRunner(server, database, MigrationRunner.FindRepoDir(Path.Combine("db", "migrations")));
    var applied = await runner.MigrateAsync();
    Console.WriteLine(applied.Count == 0 ? "up to date" : "applied: " + string.Join(", ", applied));
    if (seedDev)
    {
        await runner.SeedDevAsync(Path.Combine(MigrationRunner.FindRepoDir("db"), "seed", "dev-seed.sql"));
        Console.WriteLine("seeded: dev tenant");
    }
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine("ERROR: " + ex.Message);
    return 1;
}
