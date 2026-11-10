using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Chime.Api.Data.Migrations;

/// <inheritdoc />
public partial class _20261110210803_BrowserWebPush : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "WebPushAuth",
            table: "Devices",
            type: "TEXT",
            maxLength: 100,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "WebPushEndpoint",
            table: "Devices",
            type: "TEXT",
            maxLength: 2048,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "WebPushP256dh",
            table: "Devices",
            type: "TEXT",
            maxLength: 200,
            nullable: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "WebPushAuth",
            table: "Devices");

        migrationBuilder.DropColumn(
            name: "WebPushEndpoint",
            table: "Devices");

        migrationBuilder.DropColumn(
            name: "WebPushP256dh",
            table: "Devices");
    }
}
