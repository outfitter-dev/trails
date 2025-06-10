package commands

import (
	"fmt"
	"os/exec"

	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(installDepsCmd)
}

var installDepsCmd = &cobra.Command{
	Use:   "install-deps",
	Short: "Check and install required dependencies",
	Long:  `Check and install required dependencies for trails to function properly.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Println("Checking trails dependencies...")

		// Check Docker/container runtime
		if _, err := exec.LookPath("docker"); err != nil {
			fmt.Println("❌ Docker not found")
			fmt.Println("\nTrails uses Dagger for container management, which requires Docker.")
			fmt.Println("Please install Docker from: https://docs.docker.com/get-docker/")
			return fmt.Errorf("Docker is required but not installed")
		}
		fmt.Println("✓ Docker is installed")

		// Check if Docker is running
		if err := exec.Command("docker", "info").Run(); err != nil {
			fmt.Println("❌ Docker is not running")
			fmt.Println("\nPlease start Docker before running trails.")
			return fmt.Errorf("Docker is installed but not running")
		}
		fmt.Println("✓ Docker is running")

		fmt.Println("\n✓ All dependencies are satisfied!")
		fmt.Println("\nTrails uses the Dagger SDK for container management.")
		fmt.Println("No additional installation is required.")
		return nil
	},
}
