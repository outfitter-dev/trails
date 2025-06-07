package commands

import (
	"fmt"
	"os"

	"github.com/maybe-good/agentish/internal/session"
	"github.com/maybe-good/agentish/internal/state"
	"github.com/spf13/cobra"
)

var listSessionsCmd = &cobra.Command{
	Use:     "list-sessions",
	Short:   "List all active sessions",
	Aliases: []string{"ls"},
	RunE: func(cmd *cobra.Command, args []string) error {
		wd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("failed to get working directory: %w", err)
		}

		st, close, err := state.Load(wd)
		if err != nil {
			return fmt.Errorf("failed to load state: %w", err)
		}
		defer close()

		sessions := st.GetOrderedSessions()

		if len(sessions) == 0 {
			fmt.Println("No active sessions")
			return nil
		}

		for _, sess := range sessions {
			status := "●"
			if sess.Status == session.StatusReady {
				status = "○"
			} else if sess.Status == session.StatusError {
				status = "✗"
			}

			fmt.Printf("%s %s (%s) - %s [%s]\\n",
				status,
				sess.GetDisplayName(),
				sess.Agent,
				sess.GetStatusDisplay(),
				sess.EnvironmentID.String())
		}

		return nil
	},
}

func init() {
	rootCmd.AddCommand(listSessionsCmd)
} 