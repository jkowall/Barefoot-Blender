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
        <div className={`card accordion-card ${isExpanded ? "open" : ""}`}>
            <button className="accordion-header" type="button" onClick={handleToggle}>
                <h2>{title}</h2>
                <span className={`accordion-icon ${isExpanded ? "open" : ""}`}>{isExpanded ? "−" : "+"}</span>
            </button>
            <div className={`accordion-content ${isExpanded ? "open" : ""}`}>
                {children}
            </div>
        </div>
    );
};
