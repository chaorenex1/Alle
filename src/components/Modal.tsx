import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// 弹窗统一挂到 body：侧边栏有 z-20 的层叠上下文，留在里面会被邮件面板（z-30）盖住。
export default function Modal({
	onClose,
	disabled = false,
	children,
}: {
	onClose: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-6"
			onMouseDown={() => {
				if (!disabled) onClose();
			}}
		>
			{children}
		</div>,
		document.body,
	);
}
