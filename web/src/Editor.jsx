import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'

// Slash-menu block types. Each `run` receives a live chain and returns it.
const SLASH_ITEMS = [
  { key: 'h1', label: 'Heading 1', hint: 'H1', run: (c) => c.toggleHeading({ level: 1 }) },
  { key: 'h2', label: 'Heading 2', hint: 'H2', run: (c) => c.toggleHeading({ level: 2 }) },
  { key: 'h3', label: 'Heading 3', hint: 'H3', run: (c) => c.toggleHeading({ level: 3 }) },
  { key: 'bullet', label: 'Bullet list', hint: '•', run: (c) => c.toggleBulletList() },
  { key: 'ordered', label: 'Numbered list', hint: '1.', run: (c) => c.toggleOrderedList() },
  { key: 'todo', label: 'To-do', hint: '☐', run: (c) => c.toggleTaskList() },
  { key: 'quote', label: 'Quote', hint: '”', run: (c) => c.toggleBlockquote() },
  { key: 'code', label: 'Code', hint: '‹/›', run: (c) => c.toggleCodeBlock() },
  { key: 'divider', label: 'Divider', hint: '—', run: (c) => c.setHorizontalRule() },
  { key: 'linknote', label: 'Link to note', hint: '[[ ]]', linknote: true },
]

// prosemirror-markdown escapes `[` and `]` in text, which would turn a literal
// [[Wikilink]] into \[\[Wikilink\]\]. Restore the wikilink brackets so the
// backend (and the demo store) can parse them.
function serializeMarkdown(editor) {
  return (editor.storage.markdown.getMarkdown() || '')
    .replace(/\\\[\\\[/g, '[[')
    .replace(/\\\]\\\]/g, ']]')
}

function filterNotes(allNotes, query) {
  const q = (query || '').toLowerCase().trim()
  const list = q ? allNotes.filter((n) => n.title.toLowerCase().includes(q)) : allNotes
  return list.slice(0, 8)
}

/**
 * The rich-text surface. Loads FROM `body_md`, serialises back TO markdown,
 * and hosts the bubble toolbar, slash menu, and [[wikilink]] autocomplete.
 */
export default function Editor({ note, allNotes, onChange }) {
  const [menu, setMenu] = useState(null) // { type, trigger?, query, items, index, coords }
  const editorRef = useRef(null)
  const ctxRef = useRef({})
  const notesRef = useRef(allNotes)
  notesRef.current = allNotes

  // Recompute which (if any) inline menu should be showing, given the caret.
  const refresh = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const { state, view } = ed
    const sel = state.selection
    if (!sel.empty) { setMenu(null); return }
    const $from = sel.$from
    const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼')

    const wiki = before.match(/(\[\[|@)([^\]\n@]*)$/)
    if (wiki) {
      const coords = view.coordsAtPos(sel.from)
      setMenu({
        type: 'wiki', trigger: wiki[1], query: wiki[2],
        items: filterNotes(notesRef.current, wiki[2]), index: 0,
        coords: { left: coords.left, top: coords.bottom },
      })
      return
    }

    const slash = before.match(/^\/(\w*)$/)
    if (slash && $from.parent.type.name === 'paragraph' &&
        $from.parentOffset === $from.parent.content.size) {
      const q = slash[1].toLowerCase()
      const items = q ? SLASH_ITEMS.filter((it) => it.label.toLowerCase().includes(q)) : SLASH_ITEMS
      const coords = view.coordsAtPos(sel.from)
      setMenu({ type: 'slash', query: slash[1], items, index: 0, coords: { left: coords.left, top: coords.bottom } })
      return
    }
    setMenu(null)
  }, [])

  const apply = useCallback((activeMenu, item) => {
    const ed = editorRef.current
    if (!ed || !item) return
    const from = ed.state.selection.from
    if (activeMenu.type === 'wiki') {
      const start = from - (activeMenu.trigger.length + activeMenu.query.length)
      ed.chain().focus().deleteRange({ from: start, to: from }).insertContent(`[[${item.title}]] `).run()
      setMenu(null)
      return
    }
    const start = from - (activeMenu.query.length + 1)
    if (item.linknote) {
      ed.chain().focus().deleteRange({ from: start, to: from }).insertContent('[[').run()
      return // refresh() (via onUpdate) will now open the wiki menu
    }
    const chain = ed.chain().focus().deleteRange({ from: start, to: from })
    item.run(chain).run()
    setMenu(null)
  }, [])

  // Keep the latest handlers/state reachable from the (create-once) keydown hook.
  ctxRef.current = { menu, setMenu, apply }

  const handleKeyDown = useCallback((_view, event) => {
    const { menu: m, setMenu: setM, apply: ap } = ctxRef.current
    if (!m || !m.items.length) return false
    if (event.key === 'ArrowDown') {
      setM({ ...m, index: (m.index + 1) % m.items.length }); return true
    }
    if (event.key === 'ArrowUp') {
      setM({ ...m, index: (m.index - 1 + m.items.length) % m.items.length }); return true
    }
    if (event.key === 'Enter') { ap(m, m.items[m.index]); return true }
    if (event.key === 'Escape') { setM(null); return true }
    return false
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: 'lb-link' } }),
      TaskList.configure({ HTMLAttributes: { class: 'lb-todo' } }),
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
    ],
    content: note ? note.body_md : '',
    editorProps: { attributes: { class: 'lb-pm', spellcheck: 'true' }, handleKeyDown },
    onUpdate: ({ editor: ed }) => {
      refresh()
      onChange(serializeMarkdown(ed))
    },
    onSelectionUpdate: refresh,
  }, [])

  useEffect(() => { editorRef.current = editor }, [editor])

  // Load a different note into the surface without firing a save.
  const loadedId = useRef(null)
  useEffect(() => {
    if (!editor || !note) return
    if (loadedId.current === note.id) return
    loadedId.current = note.id
    editor.commands.setContent(note.body_md || '', { emitUpdate: false })
    setMenu(null)
  }, [editor, note])

  const promptLink = () => {
    if (!editor) return
    const prev = editor.getAttributes('link').href || ''
    const url = window.prompt('Link URL', prev)
    if (url === null) return
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  if (!editor) return null

  const bb = (active, cls, label, onClick) => (
    <button type="button" className={`lb-bb ${cls} ${active ? 'on' : ''}`}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={label} aria-label={label}>
      {label}
    </button>
  )

  // always-visible toolbar button (paper style)
  const tb = (active, label, title, onClick) => (
    <button type="button" className={`lb-tb-btn ${active ? 'on' : ''}`}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title} aria-label={title}>
      {label}
    </button>
  )

  const textStyle = editor.isActive('heading', { level: 1 }) ? 'h1'
    : editor.isActive('heading', { level: 2 }) ? 'h2'
      : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'
  const setTextStyle = (v) => {
    const c = editor.chain().focus()
    if (v === 'p') c.setParagraph().run()
    else c.setHeading({ level: Number(v[1]) }).run()
  }

  return (
    <>
      {/* the always-there toolbar — nothing to memorise */}
      <div className="lb-tb" role="toolbar" aria-label="Formatting">
        <select className="lb-tb-sel" value={textStyle}
          onChange={(e) => setTextStyle(e.target.value)} aria-label="Text size">
          <option value="p">Normal text</option>
          <option value="h1">Heading — large</option>
          <option value="h2">Heading — medium</option>
          <option value="h3">Heading — small</option>
        </select>
        <span className="lb-tb-sep" />
        {tb(editor.isActive('bold'), <b>B</b>, 'Bold', () => editor.chain().focus().toggleBold().run())}
        {tb(editor.isActive('italic'), <i>I</i>, 'Italic', () => editor.chain().focus().toggleItalic().run())}
        {tb(editor.isActive('strike'), <s>S</s>, 'Strikethrough', () => editor.chain().focus().toggleStrike().run())}
        <span className="lb-tb-sep" />
        {tb(editor.isActive('bulletList'), '• List', 'Bullet list', () => editor.chain().focus().toggleBulletList().run())}
        {tb(editor.isActive('orderedList'), '1. List', 'Numbered list', () => editor.chain().focus().toggleOrderedList().run())}
        {tb(editor.isActive('taskList'), '☐ To-do', 'Checklist', () => editor.chain().focus().toggleTaskList().run())}
        <span className="lb-tb-sep" />
        {tb(editor.isActive('blockquote'), '“ Quote', 'Quote', () => editor.chain().focus().toggleBlockquote().run())}
        {tb(editor.isActive('codeBlock'), '‹/› Code', 'Code block', () => editor.chain().focus().toggleCodeBlock().run())}
        {tb(false, '— Divider', 'Divider', () => editor.chain().focus().setHorizontalRule().run())}
        <span className="lb-tb-sep" />
        {tb(editor.isActive('link'), '⧉ Link', 'Link', promptLink)}
        {tb(false, '[[ ]] Note', 'Link to another note', () => editor.chain().focus().insertContent('[[').run())}
      </div>

      <BubbleMenu editor={editor} className="lb-bubble" options={{ placement: 'top', offset: 8 }}>
        {bb(editor.isActive('bold'), '', 'B', () => editor.chain().focus().toggleBold().run())}
        {bb(editor.isActive('italic'), 'it', 'I', () => editor.chain().focus().toggleItalic().run())}
        {bb(editor.isActive('strike'), 'st', 'S', () => editor.chain().focus().toggleStrike().run())}
        <span className="lb-bb-sep" />
        {bb(editor.isActive('heading', { level: 1 }), 'sm', 'H1', () => editor.chain().focus().toggleHeading({ level: 1 }).run())}
        {bb(editor.isActive('heading', { level: 2 }), 'sm', 'H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        {bb(editor.isActive('blockquote'), 'sm', '“ ”', () => editor.chain().focus().toggleBlockquote().run())}
        {bb(editor.isActive('code'), 'sm', '‹/›', () => editor.chain().focus().toggleCode().run())}
        <span className="lb-bb-sep" />
        {bb(editor.isActive('link'), 'sm accent', 'link', promptLink)}
      </BubbleMenu>

      <div className="lb-doc-body">
        <EditorContent editor={editor} />
      </div>

      {menu && menu.items.length > 0 && (
        <div className="lb-pop" role="listbox"
          style={{ left: menu.coords.left, top: menu.coords.top + 6 }}>
          {menu.type === 'slash'
            ? menu.items.map((it, i) => (
              <button type="button" key={it.key} role="option" aria-selected={i === menu.index}
                className={`lb-pop-row ${i === menu.index ? 'on' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => apply(menu, it)}>
                <span className="lb-pop-hint anno">{it.hint}</span>
                <span className="lb-pop-label">{it.label}</span>
              </button>
            ))
            : menu.items.map((it, i) => (
              <button type="button" key={it.id} role="option" aria-selected={i === menu.index}
                className={`lb-pop-row ${i === menu.index ? 'on' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => apply(menu, it)}
                style={{ '--c': `var(--m-${it.tag}, var(--_p-graph))` }}>
                <span className="lb-pop-dot" aria-hidden="true" />
                <span className="lb-pop-label">{it.title}</span>
              </button>
            ))}
          {menu.type === 'wiki' && (
            <div className="lb-pop-foot anno">↑↓ to choose · enter inserts [[link]]</div>
          )}
        </div>
      )}
    </>
  )
}
