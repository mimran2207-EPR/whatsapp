using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Db.Tests;

public class MigrationGuardTests
{
    [Theory]
    [InlineData("whatsapp")]
    [InlineData("ResidentComms_Test_abc123")]
    public void Allowed_names(string name) => Assert.True(MigrationRunner.IsAllowedDatabase(name));

    [Theory]
    [InlineData("master")]
    [InlineData("GlnGviaBiuv")]
    [InlineData("ResidentComms_x]; DROP DATABASE [other]; --")]
    [InlineData("ResidentComms_")]
    [InlineData("whatsapp2")]
    [InlineData("ResidentComms_a b")]
    [InlineData("whatsapp\n")]
    [InlineData("ResidentComms_x\n")]
    [InlineData("whatsapp\r\n")]
    public void Rejected_names(string name) => Assert.False(MigrationRunner.IsAllowedDatabase(name));
}
