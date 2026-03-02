/**
 * Vercel serverless: GET /api/conversation
 * Returns LinkedIn messages (conversation) by leadUuid, conversationUuid, or senderProfileUuid.
 */
import { handleConversation } from "../dist/api-handlers.js";
export default handleConversation;
