import requests as rq
import pandas as pd
from typing import Dict, List

def get_data() -> List[Dict]:
    response = rq.get("http://localhost:3001/Hack/students")
    return response.json()

def create_team_record(team: Dict) -> Dict:
    record = {
        "Team Name": team.get("teamname", ""),
        "Domain": team.get("Domain", ""),
        "Score": team.get("Score", 0),
        "First Review Score": team.get("FirstReviewScore", 0),
        "Second Review Score": team.get("SecoundReviewScore", 0),
        "Password": team.get("password", ""),

    }
    first_total = 0
    second_total = 0
    
    # Add review data if available
    for review_type in ["FirstReview", "SecoundReview"]:
        if review_type in team:
            for key, value in team[review_type].items():
                if isinstance(value, dict) and "marks" in value:
                    record[f"{review_type}_{key}"] = value["marks"]

                    # Add to correct total
                    if review_type == "FirstReview":
                        first_total += value["marks"]
                    elif review_type == "SecoundReview":
                        second_total += value["marks"]

                else:
                    record[f"{review_type}_{key}"] = value

    # Add totals
    record["FirstReview_Total"] = first_total
    record["SecondReview_Total"] = second_total
    record["Grand_Total"] = first_total + second_total

    return record

def generate_excel():
    data = get_data()
    records = []
    
    for team in data:
        team_record = create_team_record(team)
        
        # Add team lead info
        lead_record = team_record.copy()
        lead_record.update({
            "Name": team.get("name", ""),
            "Email": team.get("email", ""),
            "Registration Number": team.get("registrationNumber", ""),
            "Role": "Team Lead",
            "Sector":team.get("Sector",""),
            "Department": team.get("department", ""),
            "Year": team.get("year", ""),
            "Section": team.get("section", ""),
            "Hostel":team.get("type",""),
            "Room": team.get("room", ""),

        })
        records.append(lead_record)
        
        # Add team members info
        for member in team.get("teamMembers", []):
            member_record = team_record.copy()
            member_record.update({
                "Name": member.get("name", ""),
                "Email":member.get("registrationNumber", "")+"@klu.ac.in",
                "Registration Number": member.get("registrationNumber", ""),
                "Role": "Team Member",
                "Sector":team.get("Sector",""),
                "Department": member.get("department", ""),
                "Year": member.get("year", ""),
                "Section": member.get("section", ""),
                "Hostel":member.get("type",''),
                "Room": member.get("room", "")
            })
            records.append(member_record)

    # Create and save Excel file
    df = pd.DataFrame(records)
    df.to_excel("hackfroge3.xlsx", index=False)
    print("Excel file generated successfully!")

if __name__ == "__main__":
    generate_excel()
