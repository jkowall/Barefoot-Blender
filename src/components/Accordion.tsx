import { type ReactNode, useState } from "react";

type AccordionItemProps = {
    title: string;
    children: ReactNode;
    defaultOpen?: boolean;
    isOpen?: boolean;
    onToggle?: () => void;
};

export const AccordionItem = ({
    title,
    children,
    defaultOpen = false,
    isOpen,
    onToggle
}: AccordionItemProps): JSX.Element => {
    const [internalOpen, setInternalOpen] = useState(defaultOpen);

    const isExpanded = isOpen !== undefined ? isOpen : internalOpen;
    const handleToggle = (): void => {
        if (onToggle) {
            onToggle();
        } else {
            setInternalOpen(!internalOpen);
        }
    };

    return (
        <div className={`accordion-item ${isExpanded ? "open" : ""}`}>
            <button className="accordion-header" type="button" onClick={handleToggle}>
                <span className="accordion-title">{title}</span>
                <span className="accordion-icon">{isExpanded ? "−" : "+"}</span>
            </button>
            {isExpanded && <div className="accordion-content">{children}</div>}
        </div>
    );
};
