import discord
import os

TOKEN = os.getenv("DISCORD_BOT_TOKEN", "YOUR_BOT_TOKEN_HERE")

intents = discord.Intents.default()
intents.message_content = True

client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f"Logged in as {client.user} (ID: {client.user.id})")
    print(f"Bot is online in {len(client.guilds)} guild(s)")
    await client.change_presence(activity=discord.Activity(
        type=discord.ActivityType.watching,
        name="updraft-9rv.pages.dev"
    ))

@client.event
async def on_message(message):
    if message.author == client.user:
        return
    if client.user in message.mentions:
        await message.channel.send(f"Hey {message.author.mention}! I'm online.")

if __name__ == "__main__":
    if TOKEN == "YOUR_BOT_TOKEN_HERE":
        print("ERROR: Set the DISCORD_BOT_TOKEN environment variable or edit the TOKEN variable.")
    else:
        client.run(TOKEN)
