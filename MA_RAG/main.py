# main.py
from core.downloader import download_github_repo, delete_dir
from core.loader import count_valid_suppoted_files, load_repository_as_documents
from core.splitter import custom_splitter
from core.embeddings import build_vector_db
from agent.graph import build_workflow
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage
from pathlib import Path
import os
from config import MAX_FILES_TO_CREATE_VECTOR_DB

load_dotenv()

def main():
    repo_url = "https://github.com/openai/codex"
    
    current_dir = Path(os.getcwd())
    temp_git_repo_storage = current_dir / "temp_git_repo_storage"

    # 1. Setup Environment
    print("Initializing RAG Environment...")
    delete_dir(temp_git_repo_storage)
    temp_git_repo_storage.mkdir(parents=True, exist_ok=True)

    try:
        extracted_path = download_github_repo(repo_url, temp_git_repo_storage)
        print(f"\nRepo ready at: {extracted_path}")
    except Exception as e:
        print(f"Failed to download repository: {e}")
        raise

    # 2. Build Database and App
    print("PreParing...")
    if count_valid_suppoted_files(temp_git_repo_storage) > MAX_FILES_TO_CREATE_VECTOR_DB:
        app = build_workflow(temp_git_repo_storage, False)
    else:
        doc = load_repository_as_documents(temp_git_repo_storage)
        all_splits = custom_splitter(doc, current_dir)
        vector_db = build_vector_db(all_splits)
        app = build_workflow(temp_git_repo_storage, True, all_splits, vector_db)

    chat_history = [] 
    
    while True:
        user_input = input("\nYou: ")
        
        if user_input.lower() in ['exit', 'quit']:
            break
            
        if not user_input.strip():
            continue

        chat_history.append(HumanMessage(content=user_input))
        
        config = {"recursion_limit": 100}
        
        for event in app.stream({"messages": chat_history}, stream_mode="values", config=config):
            message = event["messages"][-1]
            message.pretty_print()
            
        # Append the final AI message to history to maintain context
        chat_history.append(message)
if __name__ == "__main__":
    main()