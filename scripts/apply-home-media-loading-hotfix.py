from pathlib import Path

path = Path("artifacts/legendstream-xplayer/components/OptimizedHomeScreenV6.tsx")
text = path.read_text()

def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    text = text.replace(old, new, 1)

replace_once(
    '  const { entries, removeProgress } = useMediaLibrary();',
    '  const { entries, loaded: mediaLibraryLoaded, removeProgress } = useMediaLibrary();',
    'media loaded state',
)

replace_once(
    '    {continueShelf.length ? <HomeShelf title={copy.continue} seeAll={copy.seeAll} items={continueShelf} onSeeAll={() => onNavigate("history")} /> : null}',
    '    {continueShelf.length || !mediaLibraryLoaded ? <HomeShelf title={copy.continue} seeAll={copy.seeAll} items={continueShelf} onSeeAll={() => onNavigate("history")} loading={!mediaLibraryLoaded} /> : null}',
    'continue shelf hydration',
)

path.write_text(text)
