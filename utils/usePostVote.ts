import { useContext, useEffect, useRef, useState } from "react";
import { UserAuth } from "../api/Authentication";
import { setVote } from "../api/gql/Vote";
import {
  captureWebSession,
  isWebSessionCurrent,
  WebSessionChangedError,
} from "../api/gql/WebToken";
import type { VoteOption } from "../api/Posts";
import type { UserContent } from "../api/User";
import { ToastContext } from "../contexts/ToastContext";
import { AccountContext } from "../contexts/AccountContext";
import { createVoteQueue, createVoteQueues } from "./voteQueue";

type Votable = Pick<UserContent, "name" | "type" | "userVote" | "upvotes">;

export default function usePostVote<T extends Votable>(
  post: T,
  update: (change: (current: T) => T) => void,
) {
  const { currentUser } = useContext(AccountContext);
  const { showToast } = useContext(ToastContext);
  const account = currentUser?.userName;
  const identity = useRef({
    account,
    name: post.name,
    credentials: captureWebSession(currentUser?.id ?? ""),
  });
  if (
    identity.current.account !== account ||
    !isWebSessionCurrent(identity.current.credentials)
  )
    identity.current = {
      account,
      name: post.name,
      credentials: captureWebSession(currentUser?.id ?? ""),
    };
  else identity.current.name = post.name;
  const session = identity.current;
  const generation = session.credentials.generation;
  const key = `${account}:${generation}:${post.name}`;
  const [pending] = useState(createVoteQueues);
  useEffect(() => () => pending.retire(), [account, generation, pending]);

  return (direction: VoteOption) => {
    if (!UserAuth.isLoggedIn || !currentUser) {
      showToast({ title: "Couldn't vote", body: "Log in to vote." });
      return;
    }
    const queue = pending.get(key, (settled) =>
      createVoteQueue(
        post.userVote,
        async (next) => {
          if (identity.current !== session)
            throw new Error("Vote context changed");
          await setVote(post, next, session.credentials);
        },
        (next) => {
          update((current) =>
            current.name === post.name &&
            identity.current === session &&
            isWebSessionCurrent(session.credentials)
              ? {
                  ...current,
                  userVote: next,
                  upvotes: current.upvotes - current.userVote + next,
                }
              : current,
          );
        },
        (error) => {
          if (
            !(error instanceof WebSessionChangedError) &&
            identity.current === session &&
            isWebSessionCurrent(session.credentials) &&
            session.name === post.name
          )
            showToast({
              title: "Vote Failed",
              body: "Your vote wasn't confirmed, Please try again.",
            });
        },
        settled,
      ),
    );
    queue.press(direction);
  };
}
