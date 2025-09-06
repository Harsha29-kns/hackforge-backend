# check_duplicates.py
import pandas as pd

# Config
INPUT_FILE = "pass.xlsx"      # change if needed
SHEET_NAME = 0                     # sheet index or name
OUTPUT_FILE = "duplicates_report.xlsx"

# Read
df = pd.read_excel(INPUT_FILE, sheet_name=SHEET_NAME)

# Ensure column name - try to find 'Password' column; fallback to first column
if 'Password' not in df.columns:
    df.columns = ['Password'] + list(df.columns[1:])

# Trim and normalize (optional)
df['_pwd_norm'] = df['Password'].astype(str).str.strip()

# Count duplicates
counts = df['_pwd_norm'].value_counts().rename_axis('Password_norm').reset_index(name='Count')

# Merge counts back to original
df = df.merge(counts, left_on='_pwd_norm', right_on='Password_norm', how='left')

# Flag duplicates and create report
df['Status'] = df['Count'].apply(lambda x: 'DUPLICATE' if x > 1 else 'UNIQUE')

# Output full annotated sheet and a separate sheet of only duplicates
with pd.ExcelWriter(OUTPUT_FILE, engine='openpyxl') as writer:
    df.drop(columns=['_pwd_norm','Password_norm']).to_excel(writer, sheet_name='Annotated', index=False)
    df[df['Status']=='DUPLICATE'].drop(columns=['_pwd_norm','Password_norm']).to_excel(writer, sheet_name='Duplicates_only', index=False)
    counts.to_excel(writer, sheet_name='Counts', index=False)

print(f"Report written to {OUTPUT_FILE}")
