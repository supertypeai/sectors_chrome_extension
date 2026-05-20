import os
import json
from dotenv import load_dotenv
from supabase import create_client, Client

def main():
    # Load dotenv from the local directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    dotenv_path = os.path.join(script_dir, ".env")
    if os.path.exists(dotenv_path):
        load_dotenv(dotenv_path)
    else:
        load_dotenv()  # Fallback to standard system environment lookup

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")

    if not supabase_url or not supabase_key:
        print("Error: SUPABASE_URL or SUPABASE_KEY environment variables not set.")
        exit(1)

    print("Connecting to Supabase...")
    supabase: Client = create_client(supabase_url, supabase_key)

    symbols = set()

    # 1. Fetch IDX active company symbols
    try:
        print("Fetching IDX symbols...")
        limit = 1000
        offset = 0
        while True:
            response = supabase.table("idx_active_company_profile") \
                .select("symbol") \
                .range(offset, offset + limit - 1) \
                .execute()
            
            data = response.data
            if not data:
                break
                
            for row in data:
                sym = row.get("symbol")
                if sym:
                    sym = sym.strip().upper()
                    # Ensure it has .JK ending
                    if not sym.endswith(".JK"):
                        sym = f"{sym}.JK"
                    symbols.add(sym)
                    
            if len(data) < limit:
                break
            offset += limit
            
        print(f"Total IDX symbols loaded so far: {len(symbols)}")
    except Exception as e:
        print(f"Warning: Failed to fetch IDX symbols: {e}")

    idx_count = len(symbols)

    # 2. Fetch SGX company report symbols
    try:
        print("Fetching SGX symbols...")
        limit = 1000
        offset = 0
        while True:
            response = supabase.table("sgx_company_report") \
                .select("symbol") \
                .range(offset, offset + limit - 1) \
                .execute()
            
            data = response.data
            if not data:
                break
                
            for row in data:
                sym = row.get("symbol")
                if sym:
                    sym = sym.strip().upper()
                    # Normalize: append .SI ending if not present
                    if not sym.endswith(".SI"):
                        sym = f"{sym}.SI"
                    symbols.add(sym)
                    
            if len(data) < limit:
                break
            offset += limit
            
        print(f"Total symbols loaded after SGX: {len(symbols)}")
    except Exception as e:
        print(f"Warning: Failed to fetch SGX symbols: {e}")

    sgx_count = len(symbols) - idx_count

    # Sort the symbols alphabetically
    sorted_symbols = sorted(list(symbols))

    # Path to write the JSON list - Now saved in the main folder (root of the workspace)
    project_root = os.path.dirname(script_dir)
    output_path = os.path.join(project_root, "active_companies.json")
    
    # Write minified JSON (compact, no spaces or newlines) for absolute efficiency
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(sorted_symbols, f, separators=(',', ':'))
        
    print(f"Successfully generated {output_path} with {len(sorted_symbols)} symbols.")
    print(f"IDX symbols: {idx_count}, SGX symbols: {sgx_count}")

if __name__ == "__main__":
    main()
