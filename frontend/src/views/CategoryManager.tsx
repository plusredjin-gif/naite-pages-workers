/**
 * 나이테 Pages-only — 카테고리 관리
 *
 * 기능: api.categories.list/create/update/remove 사용.
 * 생성(이름·색상·아이콘·상위 카테고리), 수정(이름·색상·아이콘·상위 변경),
 * 삭제(확인 문구 표시. 하위 카테고리는 상위로 올라가고 메모는 미분류가 됨).
 * 아이콘 18종·색상 8종 고정 팔레트. 상위 변경 시 자기 자신과 자기 하위
 * 카테고리는 선택지에서 제외해 순환을 막는다.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type Category } from "../api";
import { Teapot } from "../components/Logo";
import "./CategoryManager.css";

const ICONS = [
  "📁", "💼", "👤", "💡", "📝", "📌", "⭐", "🏠",
  "🌳", "📷", "🎵", "📅", "✅", "🔍", "💬", "📚", "🚗", "⚙️",
];

const COLORS = [
  "#556030", "#A2301B", "#C63E2D", "#D4AF37",
  "#2E7D32", "#1565C0", "#6A1B9A", "#666666",
];

/** id의 모든 하위 카테고리 id. */
function descendantIds(cats: Category[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const c of cats) {
    if (!c.parentId) continue;
    const arr = children.get(c.parentId) ?? [];
    arr.push(c.id);
    children.set(c.parentId, arr);
  }
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const ch of children.get(cur) ?? []) {
      if (!out.has(ch)) {
        out.add(ch);
        stack.push(ch);
      }
    }
  }
  return out;
}

function buildChildren(cats: Category[]): Map<string | null, Category[]> {
  const map = new Map<string | null, Category[]>();
  for (const c of cats) {
    const key = c.parentId ?? null;
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  return map;
}

export function CategoryManager(props: { setNotice: (msg: string | null) => void }) {
  const { setNotice } = props;
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 폼 상태 (생성·수정 공용)
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState(ICONS[0]);
  const [parentId, setParentId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.categories.list();
      setCategories(res.categories);
    } catch (e) {
      if ((e as { code?: string }).code === "TOKEN_EXPIRED_RELOGIN_REQUIRED") {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setError(`카테고리를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [setNotice]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setName("");
    setColor(COLORS[0]);
    setIcon(ICONS[0]);
    setParentId("");
    setEditingId(null);
  }

  function startEdit(cat: Category) {
    setEditingId(cat.id);
    setName(cat.name);
    setColor(cat.color ?? COLORS[0]);
    setIcon(cat.icon ?? ICONS[0]);
    setParentId(cat.parentId ?? "");
    setDeleteTarget(null);
  }

  // 상위 선택지: 수정 중이면 자기 자신 + 자기 하위 카테고리 제외 (순환 방지).
  const excludedParentIds = new Set<string>();
  if (editingId) {
    excludedParentIds.add(editingId);
    for (const id of descendantIds(categories, editingId)) excludedParentIds.add(id);
  }
  const parentOptions = categories.filter((c) => !excludedParentIds.has(c.id));

  async function handleSubmit() {
    if (!name.trim()) {
      setNotice("카테고리 이름을 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await api.categories.update(editingId, {
          name: name.trim(),
          color,
          icon,
          parentId: parentId || null,
        });
        setNotice("카테고리를 수정했습니다.");
      } else {
        await api.categories.create({
          name: name.trim(),
          color,
          icon,
          parentId: parentId || null,
        });
        setNotice("카테고리를 만들었습니다.");
      }
      resetForm();
      await load();
    } catch (e) {
      if ((e as { code?: string }).code === "TOKEN_EXPIRED_RELOGIN_REQUIRED") {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(
          `카테고리를 저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(cat: Category) {
    setBusy(true);
    try {
      await api.categories.remove(cat.id);
      setNotice(
        "카테고리를 삭제했습니다. 하위 카테고리는 상위로 이동했고, 메모는 미분류가 됐습니다.",
      );
      setDeleteTarget(null);
      if (editingId === cat.id) resetForm();
      await load();
    } catch (e) {
      if ((e as { code?: string }).code === "TOKEN_EXPIRED_RELOGIN_REQUIRED") {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(
          `카테고리를 삭제하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const childrenMap = buildChildren(categories);
  const roots = childrenMap.get(null) ?? [];

  function renderCategory(cat: Category, depth: number): ReactNode {
    const children = childrenMap.get(cat.id) ?? [];
    const isDeleting = deleteTarget?.id === cat.id;
    return (
      <div key={cat.id} className="catman-node" style={{ marginLeft: depth * 16 }}>
        <div className="card catman-row">
          <span className="cat-dot" style={{ backgroundColor: cat.color ?? "#cccccc" }} />
          <span className="catman-icon">{cat.icon ?? "📁"}</span>
          <span className="catman-name">{cat.name}</span>
          <span className="catman-actions">
            <button type="button" onClick={() => startEdit(cat)} disabled={busy}>
              수정
            </button>
            <button
              type="button"
              onClick={() => setDeleteTarget(isDeleting ? null : cat)}
              disabled={busy}
            >
              삭제
            </button>
          </span>
        </div>
        {isDeleting ? (
          <div className="notice catman-delete-confirm">
            <p>
              “{cat.name}”을(를) 삭제할까요? 하위 카테고리는 상위로 올라가고, 이
              카테고리의 메모는 미분류가 됩니다. 삭제한 카테고리는 되돌릴 수 없습니다.
            </p>
            <div className="toolbar">
              <button type="button" onClick={() => void handleDelete(cat)} disabled={busy}>
                삭제하기
              </button>
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={busy}>
                취소
              </button>
            </div>
          </div>
        ) : null}
        {children.map((ch) => renderCategory(ch, depth + 1))}
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <h2 className="catman-form-title">
          {editingId ? "카테고리 수정" : "새 카테고리"}
        </h2>
        <label className="catman-field">
          <span>이름</span>
          <input
            type="text"
            placeholder="카테고리 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="catman-field">
          <legend>색상</legend>
          <div className="chip-row" role="radiogroup" aria-label="색상">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`catman-swatch${color === c ? " selected" : ""}`}
                style={{ backgroundColor: c }}
                title={c}
                aria-label={`색상 ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="catman-field">
          <legend>아이콘</legend>
          <div className="chip-row" role="radiogroup" aria-label="아이콘">
            {ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                className={`chip${icon === ic ? " active" : ""}`}
                aria-pressed={icon === ic}
                onClick={() => setIcon(ic)}
              >
                {ic}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="catman-field">
          <span>상위 카테고리</span>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">상위 없음 (최상위)</option>
            {parentOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon ?? "📁"} {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar">
          <button type="button" onClick={() => void handleSubmit()} disabled={busy}>
            {editingId ? "수정 저장" : "카테고리 만들기"}
          </button>
          {editingId ? (
            <button type="button" onClick={resetForm} disabled={busy}>
              취소
            </button>
          ) : null}
        </div>
      </div>

      <p className="meta">카테고리 {categories.length}개</p>
      {error ? <p className="notice">{error}</p> : null}
      {loading ? <p className="meta">불러오는 중…</p> : null}
      {!loading && categories.length === 0 && !error ? (
        <div className="empty-state">
          <Teapot expression="cheer" />
          <p>카테고리가 없습니다. 위에서 첫 카테고리를 만들어보세요.</p>
        </div>
      ) : null}
      <div>{roots.map((c) => renderCategory(c, 0))}</div>
    </div>
  );
}
