using System.Text.RegularExpressions;
using ResidentComms.Domain.Status;
using ResidentComms.Infrastructure.Messaging;
using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Infrastructure.Tests.Messaging;

public class StatusMapperTests
{
    // Reads the CHECK lists from the migration itself, so enum, mapper and schema cannot drift apart.
    private static HashSet<string> CheckValues(string column)
    {
        var sql = File.ReadAllText(Path.Combine(MigrationRunner.FindRepoDir(Path.Combine("db", "migrations")), "V001__core_schema.sql"));
        var m = Regex.Match(sql, $@"\b{column}\s+VARCHAR\(\d+\)\s+NOT NULL\s+CHECK\s*\(\s*{column}\s+IN\s*\(([^)]*)\)");
        Assert.True(m.Success, $"CHECK for {column} not found");
        return m.Groups[1].Value.Split(',').Select(s => s.Trim().Trim('\'')).ToHashSet();
    }

    private static void RoundTrips<T>(string column) where T : struct, Enum
    {
        var mapped = new HashSet<string>();
        foreach (var v in Enum.GetValues<T>())
        {
            var s = StatusMapper.ToDb(v);
            Assert.Equal(v, StatusMapper.FromDb<T>(s));
            mapped.Add(s);
        }
        Assert.Equal(CheckValues(column), mapped);
    }

    [Fact] public void ProcessingState_round_trips_to_db_check_values() => RoundTrips<ProcessingState>("processing_state");
    [Fact] public void HandoffState_round_trips_to_db_check_values() => RoundTrips<HandoffState>("handoff_state");
    [Fact] public void DeliveryState_round_trips_to_db_check_values() => RoundTrips<DeliveryState>("delivery_state");
    [Fact] public void DataQuality_round_trips_to_db_check_values() => RoundTrips<DataQuality>("data_quality");

    [Fact] public void Unknown_db_value_throws() => Assert.Throws<ArgumentOutOfRangeException>(() => StatusMapper.FromDb<DeliveryState>("SOMETHING"));
}
