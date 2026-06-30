import discord, os

client = discord.Client(intents=discord.Intents.default())

@client.event
async def on_ready():
    print(f"Bot online as {client.user}")

token = os.getenv("DISCORD_BOT_TOKEN") or input("Enter bot token: ")
client.run(token)
