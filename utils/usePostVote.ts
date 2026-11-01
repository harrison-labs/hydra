import { useContext, useEffect, useRef, useState } from "react";
import { UserAuth } from "../api/Authentication";
import { setVote } from "../api/gql/Vote";
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
  const key = `${account}:${post.name}`;
  const identity = useRef({ account, name: post.name });
  if (identity.current.account !== account)
    identity.current = { account, name: post.name };
  else identity.current.name = post.name;
  const session = identity.current;
  const [pending] = useState(createVoteQueues);
  useEffect(() => () => pending.retire(), [account, pending]);

  return (direction: VoteOption) => {
    if (!UserAuth.isLoggedIn) {
      showToast({ title: "Couldn't vote", body: "Log in to vote." });
      return;
    }
    const queue = pending.get(key, (settled) =>
      createVoteQueue(
        post.userVote,
        async (next) => {
          if (identity.current !== session)
            throw new Error("Vote context changed");
          await setVote(post, next);
        },
        (next) => {
          update((current) =>
            current.name === post.name && identity.current === session
              ? {
                  ...current,
                  userVote: next,
                  upvotes: current.upvotes - current.userVote + next,
                }
              : current,
          );
        },
        () => {
          if (identity.current === session && session.name === post.name)
            showToast({
              title: "Vote failed",
              body: "Your vote wasn't confirmed. Please try again.",
            });
        },
        settled,
      ),
    );
    queue.press(direction);
  };
}
