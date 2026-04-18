from config import AUTO_GEN_SCAN_EXTENSIONS,AUTO_GENERATED_MARKERS,SUPPORTED_TYPES,EXCLUDE_PATTERNS
from pathlib import Path
import pathspec
import json

from langchain_core.documents import Document
from langchain_core.document_loaders.base import BaseLoader
from langchain_community.document_loaders import DirectoryLoader, TextLoader, PyPDFLoader

def is_valid(file_path):
    path = Path(file_path)

    if not path.is_file():
        return False

    name_lower = path.name.lower()
    extension = path.suffix.lower()

    if path.name in {"Dockerfile", "Makefile", "LICENSE", "Procfile", "Rakefile"}:
        return True

    if ".min." in name_lower or ".pb." in name_lower or ".g." in name_lower:
        return False

    if path.name in {".env"} or extension in {".pem", ".key"}:
        return False

    if extension == ".lock":
        return False

    # Reject auto-generated files before touching the size check 
    if extension in AUTO_GEN_SCAN_EXTENSIONS:
        try:
            with open(file_path, "r", errors="ignore") as f:
                header = f.read(512).lower()   # 512 bytes is fast; covers any header
            if any(marker.lower() in header for marker in AUTO_GENERATED_MARKERS):
                return False
        except Exception:
            pass   # If we can't read the header, fall through to normal checks

    size_kb = path.stat().st_size >> 10

    if extension in SUPPORTED_TYPES["no_limit"]:
        return True
    if extension in SUPPORTED_TYPES["limit_2048kb"]:
        return size_kb <= 2048
    if extension in SUPPORTED_TYPES["limit_50kb"]:
        return size_kb <= 50
    if extension in SUPPORTED_TYPES["limit_30kb"]:
        return size_kb <= 30
    if extension in SUPPORTED_TYPES["limit_20kb"]:
        return size_kb <= 20

    if extension != "":
        return False

    try:
        with open(file_path, "rb") as f:
            chunk = f.read(2048)
            if b"\x00" in chunk:
                return False
            chunk.decode("utf-8")
            return True
    except Exception:
        return False
    

def count_valid_suppoted_files(directory_path : Path) -> int:
    #Compile the exclusion patterns (gitwildmatch handles **/ perfectly)
    spec = pathspec.PathSpec.from_lines('gitwildmatch', EXCLUDE_PATTERNS)

    # Count files using a generator expression
    total_valid_files = sum(
        1 for item in directory_path.rglob('*') 
        if item.is_file() 
        and not spec.match_file(str(item.relative_to(directory_path))) # Check against EXCLUDE_PATTERNS
        and is_valid(item)                                       # Check against your custom logic
    )

    return total_valid_files




def _Custom_ipynbLoader(file_path):
    try:
        with open(file_path, 'r', encoding="utf-8") as f:
            notebook = json.load(f)

        cells = []
        for i, cell in enumerate(notebook.get("cells", [])):
            if cell.get("cell_type") in ["code", "markdown"]:
                source = cell.get("source", "")
                content = "".join(source) if isinstance(source, list) else source
                cells.append(f"[{cell['cell_type'].upper()} CELL {i}]\n{content}")

        extraction = "\n\n".join(cells)
        return [Document(page_content=extraction, metadata={"source": str(file_path)})]
    except Exception:
        return []


class _CustomLoader(BaseLoader):
    def __init__(self, file_path: str):
        self.file_path = file_path

    def load(self):
        if not is_valid(self.file_path):
            return []

        ext = Path(self.file_path).suffix.lower()

        try:
            if ext == ".pdf":
                return PyPDFLoader(self.file_path).load()
            elif ext == ".ipynb":
                return _Custom_ipynbLoader(self.file_path)
            else:
                try:
                    return TextLoader(self.file_path, encoding="utf-8").load()
                except UnicodeDecodeError:
                    # SAFETY: If the file has weird characters, open it manually and ignore errors
                    with open(self.file_path, "r", encoding="utf-8", errors="ignore") as f:
                        text = f.read()
                    return [Document(page_content=text, metadata={"source": self.file_path})]
                    
        except Exception as e:
            print(f"Failed to load {self.file_path}: {e}")
            return []

def load_repository_as_documents(repo_storage_path: Path) -> list[Document]:
    loader = DirectoryLoader(
        repo_storage_path,
        glob="**/*.*",
        exclude=EXCLUDE_PATTERNS,
        loader_cls=_CustomLoader,
        recursive=True,
        silent_errors=True,
        show_progress=True,
        use_multithreading=True,
    )
    
    docs = loader.load()
    print(f"Successfully loaded {len(docs)} documents.")
    return docs





