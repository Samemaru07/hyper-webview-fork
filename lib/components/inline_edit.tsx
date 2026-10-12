import React, { useEffect, useRef } from "react";

type InlineEditProps = {
    value: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
};

const InlineEdit = ({ value, onConfirm, onCancel }: InlineEditProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    // Enter/Escapeでの終了後に続けて発火するblurで、二重に確定・キャンセルしないためのフラグ
    const finished = useRef(false);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const finish = (confirmed: boolean) => {
        if (finished.current) {
            return;
        }
        finished.current = true;
        if (confirmed) {
            onConfirm(inputRef.current?.value ?? value);
        } else {
            onCancel();
        }
        window.focusActiveTerm();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        // IMEの変換中に押したEnter/Escapeは、変換の確定・取り消しなので、入力欄の終了として扱わない
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
        } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
        }
        event.stopPropagation();
    };

    return (
        <>
            <input
                ref={inputRef}
                className="inline-edit_input"
                defaultValue={value}
                data-skk-passthrough=""
                spellCheck={false}
                onKeyDown={handleKeyDown}
                onBlur={() => finish(true)}
                // ヘッダーのmouseup(端末へのフォーカス移動)とdblclick(ウィンドウ最大化)に伝播させない
                onMouseUp={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
            />

            <style jsx>{`
                .inline-edit_input {
                    box-sizing: border-box;
                    width: 100%;
                    height: 100%;
                    margin: 0;
                    padding: 0 4px;
                    border: none;
                    outline: 1px solid rgba(255, 255, 255, 0.4);
                    background: rgba(0, 0, 0, 0.35);
                    color: #fff;
                    font: inherit;
                    text-align: center;
                    -webkit-app-region: no-drag;
                }
            `}</style>
        </>
    );
};

export default InlineEdit;
