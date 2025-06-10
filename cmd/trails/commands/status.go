package commands

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/outfitter-dev/trails/internal/state"
	"github.com/spf13/cobra"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show the status of the trails environment",
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
		focused := st.GetFocusedSession()
		actionable := st.GetActionableSessions()

		status := map[string]interface{}{
			"repo_path":        wd,
			"total_sessions":   len(sessions),
			"focused_session":  nil,
			"actionable_count": len(actionable),
			"minimal_mode":     st.MinimalMode,
			"last_saved":       st.LastSaved,
		}

		if focused != nil {
			status["focused_session"] = map[string]interface{}{
				"id":          focused.ID,
				"name":        focused.GetDisplayName(),
				"agent":       focused.Agent,
				"status":      focused.Status.String(),
				"environment": focused.EnvironmentID.String(),
			}
		}

		output, err := json.MarshalIndent(status, "", "  ")
		if err != nil {
			return fmt.Errorf("failed to marshal status: %w", err)
		}

		fmt.Println(string(output))

		return nil
	},
}

func init() {
	rootCmd.AddCommand(statusCmd)
}
