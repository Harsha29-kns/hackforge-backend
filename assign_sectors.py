import pymongo
import random
import os
from dotenv import load_dotenv

# --- Connection Settings ---
# Loads environment variables from a .env file
load_dotenv()

# !!! IMPORTANT: Ensure your .env file has the correct MONGO_URI and DB_NAME
# Or replace the os.getenv calls with your actual connection strings
MONGO_URI = os.getenv("URI", "mongodb://localhost:27017/") 
DB_NAME = os.getenv("DB_NAME", "scorecraft-kare")

def assign_sectors_to_teams():
    """
    Connects to MongoDB, fetches all teams, and randomly assigns them
    to one of three sectors, with a limit of 20 teams per sector.
    This will overwrite any existing sector assignments.
    """
    client = None
    try:
        # Connect to the database
        client = pymongo.MongoClient(MONGO_URI)
        db = client[DB_NAME]
        print("✅ Successfully connected to the database.")

        # Get the collection where team data is stored
        teams_collection = db["hackforges"]
        
        # Define the sectors and the assignment rules
        sectors = ["Naruto", "Sasuke", "Itachi"]
        teams_per_sector = 20
        
        # Fetch all verified teams from the database
        all_teams = list(teams_collection.find({"verified": True}))
        
        if not all_teams:
            print("🟢 No verified teams found in the database. Nothing to assign.")
            return

        print(f"🔍 Found {len(all_teams)} verified teams to assign.")

        # Shuffle the list of teams for random distribution
        random.shuffle(all_teams)
        
        assignments_count = {sector: 0 for sector in sectors}
        assignments_made = 0

        # --- Assignment Logic ---
        for team in all_teams:
            assigned = False
            # Try to assign the team to a sector in order
            for sector in sectors:
                if assignments_count[sector] < teams_per_sector:
                    # Update the team document in the database
                    teams_collection.update_one(
                        {"_id": team["_id"]},
                        {"$set": {"Sector": sector}}
                    )
                    assignments_count[sector] += 1
                    assignments_made += 1
                    print(f"  -> Assigned sector '{sector}' to team '{team['teamname']}'.")
                    assigned = True
                    break # Move to the next team once assigned
            
            if not assigned:
                print(f"⚠️ Warning: All sectors are full. Could not assign a sector to team '{team['teamname']}'.")

        print("\n--- Assignment Summary ---")
        for sector, count in assignments_count.items():
            print(f"  - {sector}: {count} teams")
        print(f"\n✅ Successfully assigned sectors to {assignments_made} teams.")

    except pymongo.errors.ConnectionFailure as e:
        print(f"❌ Database connection failed: {e}")
    except Exception as e:
        print(f"❌ An error occurred: {e}")
    finally:
        if client:
            client.close()
            print("🚪 Database connection closed.")


if __name__ == "__main__":
    assign_sectors_to_teams()