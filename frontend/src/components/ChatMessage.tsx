import React, { FC, useEffect, useState, useRef } from "react";
import { Box } from "@mui/material";
import Prism from "react-syntax-highlighter/dist/cjs/prism";
import { dark } from "react-syntax-highlighter/dist/cjs/styles/prism";

interface ChatMessageProps {
  content: string;
  role: "assistant" | "user";
  setIsTypingFalse: any;
  userLabel?: string;
  assistantLabel?: string;
}

/**
 * Utilities to convert bullet and numbered lists without duplication.
 */
function convertBulletLists(input: string): string {
  const lines = input.split(/\r?\n/);
  let output = "";
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^[-*]\s+(.*)$/);
    if (match) {
      if (!inList) {
        output += "<ul>\n";
        inList = true;
      }
      output += `<li>${match[1]}</li>\n`;
    } else {
      if (inList) {
        output += "</ul>\n";
        inList = false;
      }
      output += line + "\n";
    }
  }
  if (inList) output += "</ul>\n";

  return output;
}

function convertNumberedLists(input: string): string {
  const lines = input.split(/\r?\n/);
  let output = "";
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      // Blank line: just add a newline without closing the list
      output += "\n";
      continue;
    }

    const match = line.match(/^(\d+)\.\s+(.*)$/);
    if (match) {
      // Start an <ol> if we aren't already in one
      if (!inList) {
        output += "<ol>\n";
        inList = true;
      }
      output += `<li>${match[2]}</li>\n`;
    } else {
      // If it's not a numbered item and we were in a <ol>, close it
      if (inList) {
        output += "</ol>\n";
        inList = false;
      }
      // Add this line as normal text
      output += line + "\n";
    }
  }

  // If we finish while still in a list, close it
  if (inList) output += "</ol>\n";

  return output;
}

/**
 * Pipeline function for transformations:
 * - hr
 * - listItems (using our bullet/numbered list converters)
 * - bold
 * - italic
 * - headings
 * - trim
 */
const processTextPipeline = (text: string, steps: string[]) => {
  const availableSteps: Record<string, (input: string) => string> = {
    hr: input => {
      const hrPattern = /^(?:[-*_]){3,}\s*$/gm;
      return input.replace(hrPattern, "<hr />");
    },
    listItems: input => {
      let result = convertBulletLists(input);
      result = convertNumberedLists(result);
      return result;
    },
    bold: input => {
      const parts = input.split(/(\*\*.*?\*\*)/);
      return parts
        .map(part => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return `<strong>${part.slice(2, -2)}</strong>`;
          }
          return part;
        })
        .join("");
    },
    italic: input => {
      const parts = input.split(/(\*.*?\*)/);
      return parts
        .map(part => {
          if (part.startsWith("*") && part.endsWith("*")) {
            return `<em>${part.slice(1, -1)}</em>`;
          }
          return part;
        })
        .join("");
    },
    headings: input => {
      const headingPattern = /^(#{1,6})\s+(.*)$/gm;
      return input.replace(headingPattern, (_, hashes, headingContent) => {
        const level = hashes.length;
        return `<h${level}>${headingContent}</h${level}>`;
      });
    },
    newlines: input => {
      // Convert newlines to <br/> tags for proper line breaks
      return input.replace(/\n/g, "<br/>");
    },
    trim: input => input.trim()
  };

  const pipeline = steps.map(step => availableSteps[step]);

  let result = text;
  for (const stepFn of pipeline) {
    if (stepFn) {
      result = stepFn(result);
    }
  }
  return result;
};

/**
 * Detects code blocks delimited by triple backticks and converts them
 * into { language, code } objects. Everything else remains as plain strings.
 */
const processText = (text: string, steps: string[]) => {
  const transformed = processTextPipeline(text, steps);

  const codeParts = transformed.split(/(```[\s\S]*?```)/);
  return codeParts.map(part => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const codeContent = part.slice(3, -3).trim();
      const [language, ...codeLines] = codeContent.split("\n");
      const code = codeLines.join("\n");
      return { language: language.trim(), code };
    }
    return part;
  });
};

const ChatMessage: FC<ChatMessageProps> = ({
  content,
  type,
  role,
  setIsTypingFalse,
  userLabel = "You",
  assistantLabel = "Assistant"
}) => {
  const [displayedText, setDisplayedText] = useState("");
  const [index, setIndex] = useState(0);
  const lastTimeout = useRef<any | null>(null);

  // Display content immediately (no typing animation)
  useEffect(() => {
    if (!content) {
      console.warn("ChatMessage: `content` is empty or undefined.");
      return;
    }

    if (role === "user") {
      if (type == "image") {
        setDisplayedText(content[0].text);
      } else {
        setDisplayedText(content);
      }
    } else {
      // Display assistant content immediately
      setDisplayedText(content);
    }
    setIsTypingFalse?.();
  }, [content, role]);

  // Only apply the formatting pipeline if the role is "assistant"
  const pipelineSteps = ["hr", "bold", "italic", "headings", "trim", "newlines"];

  let processedParts: any[] = [];
  if (role === "assistant") {
    let tempDisplayedText = displayedText
      .replace("<think>\n\n</think>", "")
      .replace(/^\n\n/, "");

    processedParts = processText(tempDisplayedText, pipelineSteps);
  }
  return (
    <Box
      sx={{
        bgcolor: role === "user" ? "#D6D6D6" : "#FFFFFF",
        color: "black",
        p: 2,
        m: 1,
        borderRadius: 3,
        wordWrap: "break-word",
        overflow: "visible",
        textOverflow: "ellipsis",
        whiteSpace: "pre-wrap",
        maxWidth: "70%",
        alignSelf: role === "user" ? "flex-end" : "flex-start",
        marginLeft: role === "user" ? "auto" : "0",
        marginRight: role === "user" ? "0" : "auto",
        boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
        border: "1px solid #e0e0e0"
      }}
    >
      <span style={{ fontFamily: "monospace" }}>
        <span style={{ fontWeight: "bold" }}>
          {role === "user" ? userLabel : assistantLabel}:
        </span>{" "}
        {role === "assistant" &&
          processedParts.map((part, idx) => {
            // Regular text/HTML
            if (typeof part === "string") {
              return (
                <span key={idx} dangerouslySetInnerHTML={{ __html: part }} />
              );
            }
            // Code block object
            if (typeof part === "object" && part.language && part.code) {
              return (
                <Prism
                  key={idx}
                  language={part.language}
                  style={dark}
                  wrapLongLines
                >
                  {part.code}
                </Prism>
              );
            }
            return null;
          })}
        {role != "assistant" && type === "image" && (
          <div>
            <img
              src={content[1]["image_url"]["url"]}
              style={{ width: "200px" }}
              alt="Chat-generated visual"
            />
            <p>{displayedText}</p>
          </div>
        )}
        {role != "assistant" && type === "text" && <span>{displayedText}</span>}
      </span>
    </Box>
  );
};

export default ChatMessage;
