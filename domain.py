import pymongo
import random

# --- Connection Settings ---
# !!! IMPORTANT: Replace with your actual MongoDB connection string and database name
MONGO_URI = "mongodb://localhost:27017/" 
DB_NAME = "scorecraft-kare"

def assign_domains():
    """
    Connects to MongoDB, fetches teams and domains, and randomly assigns
    a domain to each team that doesn't already have one, respecting slot limits.
    """
    client = None # Initialize client to None
    try:
        # Connect to the database
        client = pymongo.MongoClient(MONGO_URI)
        db = client[DB_NAME]
        print("✅ Successfully connected to the database.")

        # Get collections
        teams_collection = db["hackforges"]  # The collection where team data is stored
        domains_collection = db["domains"]   # The collection for domain definitions

        # Fetch all teams that do not have a domain assigned yet
        teams_to_assign = list(teams_collection.find({"Domain": {"$in": [None, ""]}}))
        
        if not teams_to_assign:
            print("🟢 No teams need a domain assignment. All set!")
            return

        print(f"🔍 Found {len(teams_to_assign)} teams to assign a domain.")

        # Fetch all domains
        all_domains = list(domains_collection.find({}))
        
        if not all_domains:
            print("❌ Error: No domains found in the database. Cannot assign domains. Exiting.")
            return
            
        # Create a weighted list of available domain slots
        domain_pool = []
        for domain in all_domains:
            # Add the domain name to the pool for each available slot
            # Assumes 'slots' is the field for capacity and 'name' is the domain name
            for _ in range(domain.get("slots", 0)):
                domain_pool.append(domain["name"])
        
        print(f"📋 Total available domain slots: {len(domain_pool)}")

        # --- Assignment Logic ---
        
        # Shuffle both the teams and the domain pool to ensure randomness
        random.shuffle(teams_to_assign)
        random.shuffle(domain_pool)

        assignments_made = 0
        for team in teams_to_assign:
            if not domain_pool:
                print("⚠️ Warning: Ran out of domain slots before all teams could be assigned.")
                break

            # Pop a domain from the pool and assign it to the team
            assigned_domain = domain_pool.pop()
            
            # Update the team document in the database
            teams_collection.update_one(
                {"_id": team["_id"]},
                {"$set": {"Domain": assigned_domain}}
            )
            print(f"  -> Assigned domain '{assigned_domain}' to team '{team['teamname']}'.")
            assignments_made += 1

        print(f"\n✅ Assignment complete. Successfully assigned domains to {assignments_made} teams.")

    except pymongo.errors.ConnectionFailure as e:
        print(f"❌ Database connection failed: {e}")
    except Exception as e:
        print(f"❌ An error occurred: {e}")
    finally:
        if client:
            client.close()
            print("🚪 Database connection closed.")


if __name__ == "__main__":
    # To run the script, execute `python random_domain.py` in your terminal
    assign_domains()