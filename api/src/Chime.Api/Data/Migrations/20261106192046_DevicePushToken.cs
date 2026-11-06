using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Chime.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class DevicePushToken : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PushToken",
                table: "Devices",
                type: "TEXT",
                maxLength: 4096,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PushToken",
                table: "Devices");
        }
    }
}
