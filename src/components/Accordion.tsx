import { type ReactNode, useState, useId } from "react";

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
    const id = useId();
    const contentId = `accordion-content-${id}`;

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
            <button
                className="accordion-header"
                type="button"
                onClick={handleToggle}
                aria-expanded={isExpanded}
                aria-controls={contentId}
            >
                <h2>{title}</h2>
                <span className={`accordion-icon ${isExpanded ? "open" : ""}`} aria-hidden="true">
                    {isExpanded ? "−" : "+"}
                </span>
            </button>
            <div
                id={contentId}
                className={`accordion-content ${isExpanded ? "open" : ""}`}
                role="region"
                aria-label={title}
            >
                {children}
            </div>
        </div>
    );
};
