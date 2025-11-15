#!/usr/bin/env python3
"""Verify Dompet AI setup is complete and ready to use."""

import sys


def check_python_version():
    """Verify Python 3.11+ is installed."""
    version = sys.version_info
    if version < (3, 11):
        print(f"❌ Python 3.11+ required (you have {version.major}.{version.minor})")
        return False
    print(f"✅ Python {version.major}.{version.minor}.{version.micro}")
    return True


def check_dependencies():
    """Check all required packages are installed."""
    packages = {
        "fastapi": "FastAPI",
        "ollama": "Ollama client",
        "pandas": "Pandas",
        "pydantic": "Pydantic",
        "uvicorn": "Uvicorn",
    }
    
    all_ok = True
    for module_name, display_name in packages.items():
        try:
            __import__(module_name)
            print(f"✅ {display_name}")
        except ImportError:
            print(f"❌ {display_name} (missing)")
            all_ok = False
    
    return all_ok


def check_ollama():
    """Check if Ollama is running and has the default model."""
    try:
        from ollama import Client
        
        client = Client(host="http://127.0.0.1:11434")
        models = client.list()
        
        print("✅ Ollama server running")
        
        model_names = [m.get("name", "") for m in models.get("models", [])]
        
        if any("gemma3:1b" in name for name in model_names):
            print("✅ gemma3:1b model available")
            return True
        else:
            print("⚠️  gemma3:1b model not found (run: ollama pull gemma3:1b)")
            return False
            
    except Exception as exc:
        print(f"❌ Ollama server not reachable: {exc}")
        print("   Start it with: ollama serve")
        return False


def check_sample_csv():
    """Verify sample CSV exists."""
    from pathlib import Path
    
    csv_path = Path("sample_transactions_1000.csv")
    if csv_path.exists():
        print("✅ Sample CSV found")
        return True
    else:
        print("⚠️  sample_transactions_1000.csv not found")
        return False


def main():
    """Run all verification checks."""
    print("Dompet AI Setup Verification")
    print("=" * 40)
    print()
    
    checks = [
        ("Python version", check_python_version),
        ("Dependencies", check_dependencies),
        ("Ollama setup", check_ollama),
        ("Sample data", check_sample_csv),
    ]
    
    results = []
    
    for check_name, check_func in checks:
        print(f"\n{check_name}:")
        print("-" * 40)
        result = check_func()
        results.append(result)
    
    print()
    print("=" * 40)
    
    if all(results):
        print("✅ All checks passed! Ready to run:")
        print("   python3 -m dompet_ai sample_transactions_1000.csv")
        sys.exit(0)
    else:
        print("⚠️  Some checks failed. See above for fixes.")
        print()
        print("Quick fix:")
        print("  pip3 install -r requirements.txt")
        print("  ollama pull gemma3:1b")
        sys.exit(1)


if __name__ == "__main__":
    main()
